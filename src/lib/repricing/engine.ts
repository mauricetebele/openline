/**
 * Amazon repricing suggestion engine.
 *
 * Decision unit = ASIN + Amazon ItemCondition group. Every active SKU mapped to
 * the same ASIN+condition shares velocity (Amazon routes a sale to any of them)
 * and gets the same suggested price. Each group is classified on two axes:
 *
 *   speed        HOT | HEALTHY | SLOW | STALE    (pooled sales, days of cover)
 *   competition  WINNING | CLOSE | LOSING | ALONE (Buy Box vs our price)
 *
 * and the strategy's matrix maps the pair (the "rule") to an action. Nothing is
 * pushed here — suggestions need approval (see /api/repricing/decide). A
 * rejection snoozes that group's rule for 24 h; an approval starts the strategy
 * cooldown. No margin floor (by request) — margins are reported, not enforced.
 */
import { prisma } from '@/lib/prisma'
import { amazonItemCondition } from '@/lib/amazon/competitive-pricing'
import { resolveFees, marginAtPrice, type CalcTemplate } from '@/lib/target-margin'

export type Strategy = 'CONSERVATIVE' | 'STANDARD' | 'AGGRESSIVE'
export type Speed = 'HOT' | 'HEALTHY' | 'SLOW' | 'STALE'
export type Competition = 'WINNING' | 'LOWEST' | 'CLOSE' | 'LOSING' | 'ALONE'
type Action = 'RAISE' | 'PROBE' | 'HOLD' | 'MATCH' | 'PARTWAY' | 'UNDERCUT' | 'LOWER' | 'LOWER2'

interface StrategyParams {
  raisePct: number; lowerPct: number
  undercut: (ref: number) => number // dollars below the reference price
  maxDailyPct: number
  slowNoSaleDays: number; staleNoSaleDays: number
  targetCoverDays: number
  cooldownHours: number
  minFeedback: number // ignore competitors below this positive-feedback %
}

export const STRATEGIES: Record<Strategy, StrategyParams> = {
  CONSERVATIVE: { raisePct: 2, lowerPct: 1, undercut: () => 0.01, maxDailyPct: 3, slowNoSaleDays: 14, staleNoSaleDays: 28, targetCoverDays: 45, cooldownHours: 72, minFeedback: 95 },
  STANDARD:     { raisePct: 3, lowerPct: 2, undercut: (r) => Math.max(0.5, r * 0.005), maxDailyPct: 6, slowNoSaleDays: 10, staleNoSaleDays: 21, targetCoverDays: 30, cooldownHours: 48, minFeedback: 90 },
  AGGRESSIVE:   { raisePct: 4, lowerPct: 4, undercut: (r) => r * 0.015, maxDailyPct: 12, slowNoSaleDays: 5, staleNoSaleDays: 14, targetCoverDays: 14, cooldownHours: 24, minFeedback: 0 },
}

// LOWEST = we're the cheapest same-condition offer but don't hold the Buy Box.
const MATRIX: Record<Speed, Record<Competition, Action>> = {
  HOT:     { WINNING: 'RAISE',  LOWEST: 'PROBE', CLOSE: 'HOLD',     LOSING: 'HOLD',     ALONE: 'RAISE' },
  HEALTHY: { WINNING: 'PROBE',  LOWEST: 'HOLD',  CLOSE: 'MATCH',    LOSING: 'PARTWAY',  ALONE: 'HOLD' },
  SLOW:    { WINNING: 'HOLD',   LOWEST: 'HOLD',  CLOSE: 'UNDERCUT', LOSING: 'MATCH',    ALONE: 'LOWER' },
  STALE:   { WINNING: 'LOWER',  LOWEST: 'LOWER', CLOSE: 'UNDERCUT', LOSING: 'UNDERCUT', ALONE: 'LOWER2' },
}
const DOWN_ONLY: Action[] = ['MATCH', 'PARTWAY', 'UNDERCUT', 'LOWER', 'LOWER2']
const UP_ONLY: Action[] = ['RAISE', 'PROBE']

const CLOSE_GAP_PCT = 2
const MIN_CHANGE_PCT = 0.25
const SNOOZE_HOURS = 24
const DAY = 86_400_000

const round2 = (n: number) => Math.round(n * 100) / 100
const pgKey = (p: string, g: string | null) => `${p}:${g ?? ''}`
export const groupKeyOf = (accountId: string, asin: string, itemCondition: string) => `${accountId}|${asin}|${itemCondition}`

export interface FeedSku {
  sku: string; channel: string; price: number | null; qty: number
  units7d: number; units30d: number
  marginCurrent: number | null; marginSuggested: number | null
  mapped: boolean
}

export interface FeedGroup {
  key: string; accountId: string; asin: string; itemCondition: string
  title: string | null
  strategy: Strategy
  skus: FeedSku[]
  currentPrice: number | null
  stock: number
  units7d: number; units30d: number
  daysSinceLastSale: number | null
  daysOfCover: number | null
  buyBoxPrice: number | null; buyBoxHolder: string | null; weHoldBuyBox: boolean
  lowestCompetitor: number | null; competitorCount: number
  offersFetchedAt: string | null
  speed: Speed; competition: Competition; rule: string
  action: Action
  suggestedPrice: number | null
  changePct: number | null
  marginCurrent: { min: number | null; max: number | null }
  marginSuggested: { min: number | null; max: number | null }
  reason: string
  status: 'SUGGESTION' | 'NO_CHANGE' | 'SNOOZED' | 'COOLDOWN' | 'NO_DATA'
  snoozedUntil: string | null
  cooldownUntil: string | null
  lastRejectedAt: string | null
  lastRejectedBy: string | null
}

function fmt(n: number) { return `$${n.toFixed(2)}` }

/** Build the feed. `only` limits it to one group (used when approving). */
export async function buildRepricingFeed(only?: { accountId: string; asin: string; itemCondition: string }): Promise<FeedGroup[]> {
  const now = Date.now()

  // ── 1. Active Amazon listings with stock → groups ──────────────────────────
  const listings = await prisma.sellerListing.findMany({
    where: {
      listingStatus: 'Active', quantity: { gt: 0 }, asin: only ? only.asin : { not: null },
      ...(only ? { accountId: only.accountId } : {}),
    },
    select: { accountId: true, sku: true, asin: true, condition: true, productTitle: true, price: true, maxPrice: true, quantity: true, fulfillmentChannel: true, buyBoxPrice: true, buyBoxSeller: true, buyBoxSyncedAt: true },
  })
  type L = typeof listings[number]
  const groups = new Map<string, { accountId: string; asin: string; itemCondition: string; rows: L[] }>()
  for (const l of listings) {
    const ic = amazonItemCondition(l.condition)
    if (only && ic !== only.itemCondition) continue
    const k = groupKeyOf(l.accountId, l.asin!, ic)
    const g = groups.get(k) ?? { accountId: l.accountId, asin: l.asin!, itemCondition: ic, rows: [] }
    g.rows.push(l)
    groups.set(k, g)
  }
  if (groups.size === 0) return []
  const allSkus = listings.map(l => l.sku)
  const asins = Array.from(new Set(listings.map(l => l.asin!)))

  // ── 2. Pooled velocity from orders (live; seller_listings.sold7d is stale) ──
  const vel = await prisma.$queryRaw<{ sku: string; u7: number; u30: number; last: Date | null }[]>`
    SELECT oi."sellerSku" AS sku,
      COALESCE(SUM(oi."quantityOrdered") FILTER (WHERE o."purchaseDate" >= now() - interval '7 days'), 0)::int AS u7,
      COALESCE(SUM(oi."quantityOrdered") FILTER (WHERE o."purchaseDate" >= now() - interval '30 days'), 0)::int AS u30,
      MAX(o."purchaseDate") AS last
    FROM order_items oi JOIN orders o ON o.id = oi."orderId"
    WHERE o."orderSource" = 'amazon' AND o."workflowStatus" <> 'CANCELLED' AND oi."sellerSku" = ANY(${allSkus}::text[])
    GROUP BY oi."sellerSku"`
  const velBySku = new Map(vel.map(v => [v.sku, v]))

  // ── 3. Competition (per ASIN + condition) ──────────────────────────────────
  const offers = await prisma.competitiveOffer.findMany({
    where: { asin: { in: asins } },
    select: { accountId: true, asin: true, itemCondition: true, isMyOffer: true, landedPrice: true, shippingPrice: true, isBuyBoxWinner: true, feedbackRating: true, lastFetchedAt: true },
  })
  const offersByGroup = new Map<string, typeof offers>()
  for (const o of offers) {
    const k = groupKeyOf(o.accountId, o.asin, o.itemCondition)
    offersByGroup.set(k, [...(offersByGroup.get(k) ?? []), o])
  }

  // ── 4. Margin inputs: msku → product/grade/template, avg costs ─────────────
  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: { marketplace: 'amazon', sellerSku: { in: allSkus } },
    select: { sellerSku: true, productId: true, gradeId: true, calculationTemplateId: true, product: { select: { defaultPackagePresetId: true } } },
  })
  const mskuBySku = new Map(mskus.map(m => [m.sellerSku, m]))
  const productIds = Array.from(new Set(mskus.map(m => m.productId)))
  const templateIds = Array.from(new Set(mskus.map(m => m.calculationTemplateId).filter(Boolean) as string[]))
  const templates = templateIds.length ? await prisma.calculationTemplate.findMany({ where: { id: { in: templateIds } }, include: { packageCosts: { select: { packagePresetId: true, cost: true } } } }) : []
  const tplMap = new Map<string, CalcTemplate>(templates.map(t => [t.id, { id: t.id, name: t.name, commissionPct: t.commissionPct.toString(), packageCosts: t.packageCosts.map(pc => ({ packagePresetId: pc.packagePresetId, cost: pc.cost.toString() })) }]))
  const costMap = new Map<string, { unit: number; code: number }>()
  if (productIds.length) {
    const avgRows = await prisma.$queryRaw<{ productId: string; gradeId: string | null; u: number; c: number }[]>`
      SELECT s."productId", s."gradeId", AVG(COALESCE(pol."unitCost", s."unitCost", 0))::float8 AS u, AVG(COALESCE(cc.amount, 0))::float8 AS c
      FROM inventory_serials s
      JOIN locations loc ON loc.id = s."locationId" AND loc."isFinishedGoods" = true
      LEFT JOIN po_receipt_lines prl ON prl.id = s."receiptLineId"
      LEFT JOIN purchase_order_lines pol ON pol.id = prl."purchaseOrderLineId"
      LEFT JOIN cost_codes cc ON cc.id = pol."costCodeId"
      WHERE s.status = 'IN_STOCK' AND s."productId" = ANY(${productIds}::text[])
      GROUP BY s."productId", s."gradeId"`
    for (const r of avgRows) costMap.set(pgKey(r.productId, r.gradeId), { unit: r.u, code: r.c })
    const fbRows = await prisma.$queryRaw<{ productId: string; gradeId: string | null; u: number; c: number | null }[]>`
      SELECT DISTINCT ON (pol."productId", pol."gradeId") pol."productId", pol."gradeId", pol."unitCost"::float8 AS u, cc.amount::float8 AS c
      FROM purchase_order_lines pol LEFT JOIN cost_codes cc ON cc.id = pol."costCodeId"
      WHERE pol."productId" = ANY(${productIds}::text[])
      ORDER BY pol."productId", pol."gradeId", pol."createdAt" DESC`
    for (const r of fbRows) { const k = pgKey(r.productId, r.gradeId); if (!costMap.has(k)) costMap.set(k, { unit: r.u, code: r.c ?? 0 }) }
  }
  const skuMargin = (sku: string, price: number | null): number | null => {
    if (price == null) return null
    const m = mskuBySku.get(sku)
    if (!m) return null
    const fees = resolveFees(tplMap.get(m.calculationTemplateId ?? '') ?? null, m.product.defaultPackagePresetId)
    const cost = costMap.get(pgKey(m.productId, m.gradeId))
    if (!fees || !cost) return null
    const mg = marginAtPrice(price, cost.unit, cost.code, fees)
    return mg == null ? null : round2(mg)
  }

  // ── 5. Strategy settings + decision history ────────────────────────────────
  const settings = await prisma.repricingGroupSetting.findMany({ where: { asin: { in: asins } } })
  const strategyByGroup = new Map(settings.map(s => [groupKeyOf(s.accountId, s.asin, s.itemCondition), s.strategy as Strategy]))
  const decisions = await prisma.repricingDecision.findMany({
    where: { asin: { in: asins }, decidedAt: { gte: new Date(now - 7 * DAY) } },
    orderBy: { decidedAt: 'desc' },
  })
  const decisionsByGroup = new Map<string, typeof decisions>()
  for (const d of decisions) {
    const k = groupKeyOf(d.accountId, d.asin, d.itemCondition)
    decisionsByGroup.set(k, [...(decisionsByGroup.get(k) ?? []), d])
  }

  // ── 6. Evaluate each group ─────────────────────────────────────────────────
  const out: FeedGroup[] = []
  for (const [key, g] of Array.from(groups.entries())) {
    const strategy: Strategy = strategyByGroup.get(key) ?? 'STANDARD'
    const P = STRATEGIES[strategy]

    const prices = g.rows.map(r => (r.price != null ? Number(r.price) : null)).filter((p): p is number => p != null && p > 0)
    const currentPrice = prices.length ? Math.min(...prices) : null
    const stock = g.rows.reduce((s, r) => s + r.quantity, 0)
    let units7d = 0, units30d = 0, lastSale = 0
    for (const r of g.rows) {
      const v = velBySku.get(r.sku)
      if (!v) continue
      units7d += v.u7; units30d += v.u30
      if (v.last && v.last.getTime() > lastSale) lastSale = v.last.getTime()
    }
    const daysSinceLastSale = lastSale ? Math.floor((now - lastSale) / DAY) : null
    const daily = 0.6 * (units7d / 7) + 0.4 * (units30d / 30)
    const daysOfCover = daily > 0 ? Math.round(stock / daily) : null

    // Speed
    const noSale = daysSinceLastSale ?? Infinity
    let speed: Speed
    if (noSale >= P.staleNoSaleDays) speed = 'STALE'
    else if ((daysOfCover != null && daysOfCover < P.targetCoverDays / 2) || (units7d >= 2 && units7d / 7 > 1.5 * (units30d / 30))) speed = 'HOT'
    else if (noSale >= P.slowNoSaleDays || daysOfCover == null || daysOfCover > P.targetCoverDays * 1.5) speed = 'SLOW'
    else speed = 'HEALTHY'

    // Competition — Buy Box from the 30-min listing refresh when fresh, else offers
    const gOffers = offersByGroup.get(key) ?? []
    const mine = gOffers.find(o => o.isMyOffer)
    const ourShipping = mine ? Number(mine.shippingPrice) : 0
    const comps = gOffers.filter(o => !o.isMyOffer && (o.feedbackRating == null || Number(o.feedbackRating) >= P.minFeedback))
    const lowestCompetitor = comps.length ? Math.min(...comps.map(o => Number(o.landedPrice))) - ourShipping : null
    // seller_listings.buyBox* is the featured (New) Buy Box — only valid for New groups.
    const fresh = g.itemCondition === 'New'
      ? g.rows.find(r => r.buyBoxSyncedAt && now - r.buyBoxSyncedAt.getTime() < 6 * 3_600_000 && r.buyBoxPrice != null)
      : undefined
    let buyBoxPrice: number | null
    let buyBoxHolder: string | null
    let weHoldBuyBox: boolean
    if (fresh) {
      buyBoxPrice = Number(fresh.buyBoxPrice)
      buyBoxHolder = fresh.buyBoxSeller ?? null
      weHoldBuyBox = g.rows.some(r => r.buyBoxSeller === 'You')
    } else {
      const bb = gOffers.find(o => o.isBuyBoxWinner)
      buyBoxPrice = bb ? Number(bb.landedPrice) - ourShipping : null
      buyBoxHolder = bb ? (bb.isMyOffer ? 'You' : 'Competitor') : null
      weHoldBuyBox = !!bb?.isMyOffer
    }
    const offersFetchedAt = gOffers.length ? new Date(Math.max(...gOffers.map(o => o.lastFetchedAt.getTime()))).toISOString() : null

    // Reference = Buy Box, else the lowest same-condition competitor. Already at or
    // below it without the Buy Box ⇒ LOWEST (price isn't what's holding us back).
    let competition: Competition
    const ref = !weHoldBuyBox ? (buyBoxPrice ?? lowestCompetitor) : null
    if (weHoldBuyBox) competition = 'WINNING'
    else if (ref == null) competition = 'ALONE'
    else if (currentPrice != null && currentPrice <= ref) competition = 'LOWEST'
    else if (currentPrice != null && (currentPrice - ref) / ref * 100 <= CLOSE_GAP_PCT) competition = 'CLOSE'
    else competition = 'LOSING'

    const rule = `${speed}+${competition}`
    const action = MATRIX[speed][competition]

    // Target price
    let target: number | null = null
    let why = ''
    if (currentPrice != null) {
      switch (action) {
        case 'RAISE': target = currentPrice * (1 + P.raisePct / 100); why = `raise ${P.raisePct}%`; break
        case 'PROBE': target = currentPrice * (1 + P.raisePct / 200); why = `probe +${P.raisePct / 2}%`; break
        case 'LOWER': target = currentPrice * (1 - P.lowerPct / 100); why = `lower ${P.lowerPct}%`; break
        case 'LOWER2': target = currentPrice * (1 - (2 * P.lowerPct) / 100); why = `lower ${2 * P.lowerPct}%`; break
        case 'MATCH': if (ref != null) { target = ref; why = `match Buy Box ${fmt(ref)}` } break
        case 'PARTWAY': if (ref != null) { target = currentPrice - (currentPrice - ref) / 2; why = `halfway to Buy Box ${fmt(ref)}` } break
        case 'UNDERCUT': if (ref != null) { target = ref - P.undercut(ref); why = `undercut Buy Box ${fmt(ref)}` } break
        case 'HOLD': break
      }
      // Competitive moves only ever lower; raises only ever raise.
      if (target != null && DOWN_ONLY.includes(action) && target >= currentPrice) target = null
      if (target != null && UP_ONLY.includes(action) && target <= currentPrice) target = null
      // When we hold the Buy Box (or are lowest), don't raise past the next competitor.
      if (target != null && target > currentPrice && (weHoldBuyBox || competition === 'LOWEST') && lowestCompetitor != null) {
        const cap = lowestCompetitor - P.undercut(lowestCompetitor)
        if (cap < target) { target = Math.max(currentPrice, cap); why += ` (capped below next offer ${fmt(lowestCompetitor)})` }
      }
      if (target != null) {
        const maxMove = currentPrice * P.maxDailyPct / 100
        if (Math.abs(target - currentPrice) > maxMove) { target = currentPrice + Math.sign(target - currentPrice) * maxMove; why += ` (limited to ${P.maxDailyPct}%/day)` }
        const ceiling = g.rows.map(r => (r.maxPrice != null ? Number(r.maxPrice) : null)).filter((p): p is number => p != null)
        if (ceiling.length && target > Math.min(...ceiling)) { target = Math.min(...ceiling); why += ' (max price)' }
        target = round2(target)
        if (Math.abs(target - currentPrice) / currentPrice * 100 < MIN_CHANGE_PCT) target = null
      }
    }
    const changePct = target != null && currentPrice ? round2((target - currentPrice) / currentPrice * 100) : null

    // Per-SKU detail + margins
    const skus: FeedSku[] = g.rows.map(r => {
      const v = velBySku.get(r.sku)
      const price = r.price != null ? Number(r.price) : null
      return {
        sku: r.sku, channel: r.fulfillmentChannel, price, qty: r.quantity,
        units7d: v?.u7 ?? 0, units30d: v?.u30 ?? 0,
        marginCurrent: skuMargin(r.sku, price), marginSuggested: target != null ? skuMargin(r.sku, target) : null,
        mapped: mskuBySku.has(r.sku),
      }
    })
    const span = (vals: (number | null)[]) => { const v = vals.filter((x): x is number => x != null); return { min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null } }

    // Snooze (rejected this rule < 24h ago) / cooldown (approved within strategy window)
    const hist = decisionsByGroup.get(key) ?? []
    const snooze = hist.find(d => d.decision === 'REJECTED' && d.rule === rule && d.snoozeUntil && d.snoozeUntil.getTime() > now)
    const lastApproved = hist.find(d => d.decision === 'APPROVED')
    const cooldownEnd = lastApproved ? lastApproved.decidedAt.getTime() + P.cooldownHours * 3_600_000 : 0
    const lastRejected = hist.find(d => d.decision === 'REJECTED' && d.rule === rule)

    // No competition data at all (offers not fetched yet, no fresh Buy Box) →
    // don't guess "ALONE" and cut prices; wait for the hourly offer refresh.
    const noData = gOffers.length === 0 && !fresh
    if (noData) target = null

    let status: FeedGroup['status'] = noData ? 'NO_DATA' : target == null ? 'NO_CHANGE' : 'SUGGESTION'
    if (target != null && cooldownEnd > now) status = 'COOLDOWN'
    if (target != null && snooze) status = 'SNOOZED'

    const salesTxt = `${units7d} sold 7d / ${units30d} 30d${daysSinceLastSale != null ? ` · last sale ${daysSinceLastSale}d ago` : ' · no sales on record'}`
    const coverTxt = daysOfCover != null ? ` · ${daysOfCover}d of stock` : ''
    const compTxt = weHoldBuyBox ? 'We hold the Buy Box'
      : competition === 'LOWEST' ? `Lowest ${g.itemCondition} price (next ${fmt(ref!)})`
      : buyBoxPrice != null ? `Buy Box ${fmt(buyBoxPrice)} (${buyBoxHolder ?? 'competitor'})`
      : lowestCompetitor != null ? `Lowest ${g.itemCondition} competitor ${fmt(lowestCompetitor)}`
      : 'No competing offer'
    const reason = noData
      ? `Waiting for competitor data · ${salesTxt}${coverTxt}`
      : `${speed} · ${compTxt} · ${salesTxt}${coverTxt}${target != null ? ` → ${why}` : ' → hold'}`

    out.push({
      key, accountId: g.accountId, asin: g.asin, itemCondition: g.itemCondition,
      title: g.rows.find(r => r.productTitle)?.productTitle ?? null,
      strategy, skus, currentPrice, stock, units7d, units30d, daysSinceLastSale, daysOfCover,
      buyBoxPrice, buyBoxHolder, weHoldBuyBox, lowestCompetitor: lowestCompetitor != null ? round2(lowestCompetitor) : null,
      competitorCount: comps.length, offersFetchedAt,
      speed, competition, rule, action, suggestedPrice: target, changePct,
      marginCurrent: span(skus.map(s => s.marginCurrent)), marginSuggested: span(skus.map(s => s.marginSuggested)),
      reason, status,
      snoozedUntil: snooze?.snoozeUntil?.toISOString() ?? null,
      cooldownUntil: cooldownEnd > now ? new Date(cooldownEnd).toISOString() : null,
      lastRejectedAt: lastRejected?.decidedAt.toISOString() ?? null,
      lastRejectedBy: lastRejected?.decidedBy ?? null,
    })
  }

  // Suggestions first (largest moves first), then snoozed/cooldown, then holds
  const rank = { SUGGESTION: 0, COOLDOWN: 1, SNOOZED: 2, NO_CHANGE: 3, NO_DATA: 4 }
  out.sort((a, b) => rank[a.status] - rank[b.status] || Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
  return out
}

export const REJECT_SNOOZE_MS = SNOOZE_HOURS * 3_600_000
