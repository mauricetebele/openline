/**
 * GET /api/repricing/insights — data for the Repricing AI Insights page:
 * effective strategy parameters (defaults + overrides), recent learning runs,
 * and the feedback log (decisions with comments + Claude's replies).
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { STRATEGIES, STRATEGY_PARAM_KEYS, PARAM_DESCRIPTIONS, loadStrategies, type Strategy } from '@/lib/repricing/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [effective, overrides, learnings, feedback, counts] = await Promise.all([
    loadStrategies(),
    prisma.repricingStrategyParam.findMany(),
    prisma.repricingLearning.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.repricingDecision.findMany({
      where: { note: { not: null } },
      orderBy: { decidedAt: 'desc' }, take: 100,
      select: { id: true, asin: true, itemCondition: true, decision: true, rule: true, strategy: true, currentPrice: true, suggestedPrice: true, finalPrice: true, note: true, aiReply: true, decidedBy: true, decidedAt: true },
    }),
    prisma.repricingDecision.groupBy({ by: ['decision'], _count: { _all: true } }),
  ])

  const strategies = (['CONSERVATIVE', 'STANDARD', 'AGGRESSIVE'] as Strategy[]).map(s => ({
    strategy: s,
    params: STRATEGY_PARAM_KEYS.map(k => {
      const o = overrides.find(r => r.strategy === s && r.param === k)
      return {
        param: k, description: PARAM_DESCRIPTIONS[k],
        value: effective[s][k], defaultValue: STRATEGIES[s][k],
        overridden: !!o, source: o?.source ?? null, updatedBy: o?.updatedBy ?? null, updatedAt: o?.updatedAt ?? null,
      }
    }),
  }))

  return NextResponse.json({
    strategies,
    learnings,
    feedback: feedback.map(f => ({
      ...f,
      currentPrice: f.currentPrice != null ? Number(f.currentPrice) : null,
      suggestedPrice: f.suggestedPrice != null ? Number(f.suggestedPrice) : null,
      finalPrice: f.finalPrice != null ? Number(f.finalPrice) : null,
    })),
    decisionCounts: Object.fromEntries(counts.map(c => [c.decision, c._count._all])),
  })
}
