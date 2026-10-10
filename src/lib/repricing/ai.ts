/**
 * Repricing AI feedback loop (Claude via the official Anthropic SDK).
 *
 *  - replyToDecisionComment: a short read-back of the "why" a user left when
 *    approving / rejecting a suggestion (stored on the decision).
 *  - analyzeRepricingFeedback: reads the whole decision log (comments, the data
 *    each suggestion was based on, and measured sales before/after approved
 *    changes) and returns learnings + proposed strategy-parameter changes as
 *    structured JSON. Proposals are only applied when an admin approves them.
 *
 * Model: Claude Opus 5.5, with server-side refusal fallback ("default").
 */
import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { getAnthropicKey } from '@/lib/ai-config'
import { loadStrategies, STRATEGY_PARAM_KEYS, PARAM_DESCRIPTIONS, type Strategy, type StrategyParams } from './engine'

export const REPRICING_AI_MODEL = 'claude-opus-5-5'
const DAY = 86_400_000

/** Anthropic key: AI settings, else the Ask AI panel's key. */
async function getClient(): Promise<Anthropic> {
  let key = await getAnthropicKey()
  if (!key) {
    const s = await prisma.storeSettings.findUnique({ where: { id: 'singleton' }, select: { anthropicApiKeyEnc: true } }).catch(() => null)
    if (s?.anthropicApiKeyEnc) { try { key = decrypt(s.anthropicApiKeyEnc) } catch { /* unreadable */ } }
  }
  if (!key) throw new Error('No Anthropic API key configured — add one in Settings → AI.')
  return new Anthropic({ apiKey: key })
}

async function callClaude(opts: {
  system: string
  user: string
  effort: 'low' | 'medium' | 'high'
  maxTokens: number
  schema?: Record<string, unknown>
}): Promise<string> {
  const client = await getClient()
  const res = await client.beta.messages.create({
    model: REPRICING_AI_MODEL,
    max_tokens: opts.maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    output_config: {
      effort: opts.effort,
      ...(opts.schema ? { format: { type: 'json_schema' as const, schema: opts.schema } } : {}),
    },
  })
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request.')
  if (res.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing — try again.')
  return res.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim()
}

// ── 1. Reply to a single approve / reject comment ───────────────────────────

export async function replyToDecisionComment(decisionId: string): Promise<string | null> {
  const d = await prisma.repricingDecision.findUnique({ where: { id: decisionId } })
  if (!d || !d.note?.trim()) return null
  if (d.aiReply) return d.aiReply

  const context = {
    decision: d.decision, comment: d.note, strategy: d.strategy, rule: d.rule,
    asin: d.asin, condition: d.itemCondition,
    currentPrice: d.currentPrice != null ? Number(d.currentPrice) : null,
    suggestedPrice: d.suggestedPrice != null ? Number(d.suggestedPrice) : null,
    finalPrice: d.finalPrice != null ? Number(d.finalPrice) : null,
    marginNowPct: d.marginCurrent != null ? Number(d.marginCurrent) : null,
    marginAfterPct: d.marginFinal != null ? Number(d.marginFinal) : null,
    dataAtDecision: d.snapshot,
  }
  const reply = await callClaude({
    system:
      'You help an Amazon electronics reseller (OpenLine) tune a repricing suggestion engine. ' +
      'A team member just approved or rejected a suggestion and explained why. Reply in one or two short, plain sentences: ' +
      "say what you understand their reasoning to be, in terms of this listing's data, and what you'll take into account for future suggestions. " +
      'Be specific, no flattery, no markdown, no questions unless the comment is genuinely ambiguous.',
    user: JSON.stringify(context),
    effort: 'low',
    maxTokens: 4000,
  })
  await prisma.repricingDecision.update({ where: { id: d.id }, data: { aiReply: reply } })
  return reply
}

// ── 2. Learn from the whole decision log ────────────────────────────────────

export interface LearningProposal {
  id: string
  strategy: Strategy
  param: keyof StrategyParams
  currentValue: number
  proposedValue: number
  rationale: string
  status: 'PENDING' | 'APPLIED' | 'DISMISSED'
  decidedBy?: string
  decidedAt?: string
}

const STRATEGY_NAMES: Strategy[] = ['CONSERVATIVE', 'STANDARD', 'AGGRESSIVE']

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'learnings', 'proposals'],
  properties: {
    summary: { type: 'string' },
    learnings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'evidence', 'confidence'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          evidence: { type: 'string' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['strategy', 'param', 'proposedValue', 'rationale'],
        properties: {
          strategy: { type: 'string', enum: STRATEGY_NAMES },
          param: { type: 'string', enum: STRATEGY_PARAM_KEYS },
          proposedValue: { type: 'number' },
          rationale: { type: 'string' },
        },
      },
    },
  },
} as const

const RULES_PRIMER = `How the engine works (per ASIN + Amazon condition group; sales on any SKU in the group count for all):
- Live window: each group's "live since" = start of its current unbroken stretch live on Amazon (BUYABLE with qty, from uptime tracking); before tracking history exists, estimated from the in-stock timeline / listing creation. No-sale days and sales pace only count that live window (capped at 30 days).
- VelocityScore™ (in dataAtDecision.velocityScore): units sold per 24 h of live time on Amazon over the last 30 days, pooled across the group's SKUs; adjusted toward a typical-listing baseline when data is thin; with confidence, target (stock ÷ targetCoverDays), score since the last price change, and Buy Box share. It is the team's preferred sell-through measure — weigh it heavily.
- Speed: NEW = live for fewer than slowNoSaleDays and no sale since going live (hold; only match if Losing); STALE = no sale in staleNoSaleDays+; HOT = stock lasts < half of targetCoverDays, or 7-day pace > 1.5x the 30-day pace; SLOW = no sale in slowNoSaleDays+, or stock lasts > 1.5x targetCoverDays; else HEALTHY.
- Competition: WINNING = we hold the Buy Box; LOWEST = we're at/below the reference (Buy Box, else cheapest same-condition competitor) without the Buy Box; CLOSE = within 2% above it; LOSING = more than 2% above; ALONE = no competitor. If our offer is Prime and the reference offer isn't, the reference is raised by primePremiumPct. Competitors below minFeedback are ignored.
- Action matrix: NEW: hold everything except LOSING → match. HOT: WINNING raise, LOWEST probe (+raisePct/2), CLOSE hold, LOSING hold, ALONE raise. HEALTHY: WINNING probe, LOWEST hold, CLOSE match, LOSING halfway, ALONE hold. SLOW: WINNING hold, LOWEST hold, CLOSE undercut, LOSING match, ALONE lower. STALE: WINNING lower, LOWEST lower, CLOSE undercut, LOSING undercut, ALONE lower 2x.
- Raises are capped just under the next competitor; every move is capped at maxDailyPct; after an approval the group waits cooldownHours; a rejection snoozes that rule for 24h. Margins are shown but there is no margin floor.`

function bounds(param: keyof StrategyParams): [number, number] {
  switch (param) {
    case 'slowNoSaleDays': case 'staleNoSaleDays': case 'targetCoverDays': return [1, 365]
    case 'cooldownHours': return [1, 720]
    case 'minFeedback': return [0, 100]
    case 'undercutMin': return [0, 50]
    default: return [0, 50] // percentages
  }
}
export function validProposalValue(param: keyof StrategyParams, v: number): boolean {
  const [lo, hi] = bounds(param)
  return Number.isFinite(v) && v >= lo && v <= hi
}

export async function analyzeRepricingFeedback(createdBy: string | null) {
  const decisions = await prisma.repricingDecision.findMany({ orderBy: { decidedAt: 'desc' }, take: 400 })
  if (decisions.length === 0) throw new Error('No approve/reject decisions logged yet — make some decisions in the feed first.')

  // Measured outcome for approvals: units sold on the group's SKUs 7 days before vs after.
  type Snap = { skus?: { sku: string }[] }
  const skuSet = new Set<string>()
  for (const d of decisions) for (const s of ((d.snapshot as Snap | null)?.skus ?? [])) skuSet.add(s.sku)
  const oldest = Math.min(...decisions.map(d => d.decidedAt.getTime())) - 7 * DAY
  const sales = skuSet.size
    ? await prisma.$queryRaw<{ sku: string; at: Date; qty: number }[]>`
        SELECT oi."sellerSku" AS sku, o."purchaseDate" AS at, oi."quantityOrdered"::int AS qty
        FROM order_items oi JOIN orders o ON o.id = oi."orderId"
        WHERE o."orderSource" = 'amazon' AND o."workflowStatus" <> 'CANCELLED'
          AND oi."sellerSku" = ANY(${Array.from(skuSet)}::text[]) AND o."purchaseDate" >= ${new Date(oldest)}`
    : []
  const now = Date.now()
  const log = decisions.map(d => {
    const skus = new Set(((d.snapshot as Snap | null)?.skus ?? []).map(s => s.sku))
    const t = d.decidedAt.getTime()
    const unitsIn = (from: number, to: number) => sales.filter(s => skus.has(s.sku) && s.at.getTime() >= from && s.at.getTime() < to).reduce((a, s) => a + s.qty, 0)
    const daysAfter = Math.min(7, Math.floor((now - t) / DAY))
    return {
      decidedAt: d.decidedAt.toISOString().slice(0, 10),
      decision: d.decision, by: d.decidedBy, comment: d.note, strategy: d.strategy, rule: d.rule,
      asin: d.asin, condition: d.itemCondition,
      currentPrice: d.currentPrice != null ? Number(d.currentPrice) : null,
      suggestedPrice: d.suggestedPrice != null ? Number(d.suggestedPrice) : null,
      pushedPrice: d.finalPrice != null ? Number(d.finalPrice) : null,
      marginNowPct: d.marginCurrent != null ? Number(d.marginCurrent) : null,
      marginAfterPct: d.marginFinal != null ? Number(d.marginFinal) : null,
      dataAtDecision: d.snapshot,
      ...(d.decision === 'APPROVED' ? {
        unitsSold7dBefore: unitsIn(t - 7 * DAY, t),
        unitsSoldAfter: unitsIn(t, t + 7 * DAY),
        daysObservedAfter: daysAfter,
      } : {}),
    }
  })

  const strategies = await loadStrategies()
  const paramsTable = STRATEGY_NAMES.map(s => ({ strategy: s, ...strategies[s] }))
  const groupStrategies = await prisma.repricingGroupSetting.groupBy({ by: ['strategy'], _count: { _all: true } })

  const system =
    'You are the pricing analyst for OpenLine, an Amazon reseller of used and new electronics. ' +
    'You review how the team responded to repricing suggestions (approvals, rejections, their comments) and what happened to sales after approved changes, ' +
    'then explain what you learned and propose specific strategy-parameter changes.\n\n' +
    RULES_PRIMER + '\n\n' +
    'Parameters:\n' + STRATEGY_PARAM_KEYS.map(k => `- ${k}: ${PARAM_DESCRIPTIONS[k]}`).join('\n') + '\n\n' +
    'Guidelines: ground every learning in the log (cite counts, ASINs or comments). Weigh comments heavily — they are the team telling you what they want. ' +
    'Small samples deserve low confidence; say when there is not enough data. Propose a parameter change only when the evidence supports it, keep changes incremental, ' +
    'and propose at most 6. If something the team wants cannot be expressed with these parameters (e.g. a margin floor, a per-brand rule), describe it as a learning instead. ' +
    'Write for a busy, non-technical owner: plain English, no jargon, no markdown.'

  const user = JSON.stringify({
    currentParameters: paramsTable,
    strategyUsage: groupStrategies.map(g => ({ strategy: g.strategy, groupsExplicitlySet: g._count._all })),
    note: 'Groups default to STANDARD unless explicitly set.',
    decisionLog: log,
  })

  const text = await callClaude({ system, user, effort: 'high', maxTokens: 16000, schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown> })
  const parsed = JSON.parse(text) as {
    summary: string
    learnings: { title: string; detail: string; evidence: string; confidence: string }[]
    proposals: { strategy: Strategy; param: keyof StrategyParams; proposedValue: number; rationale: string }[]
  }

  const proposals: LearningProposal[] = parsed.proposals
    .filter(p => STRATEGY_NAMES.includes(p.strategy) && STRATEGY_PARAM_KEYS.includes(p.param) && validProposalValue(p.param, p.proposedValue))
    .map(p => ({
      id: randomUUID(), strategy: p.strategy, param: p.param,
      currentValue: strategies[p.strategy][p.param], proposedValue: p.proposedValue,
      rationale: p.rationale, status: 'PENDING' as const,
    }))
    .filter(p => p.currentValue !== p.proposedValue)

  return prisma.repricingLearning.create({
    data: {
      createdBy, model: REPRICING_AI_MODEL, decisionsAnalyzed: decisions.length,
      summary: parsed.summary, learnings: parsed.learnings, proposals: proposals as unknown as object,
    },
  })
}
