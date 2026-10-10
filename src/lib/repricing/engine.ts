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
  primePremiumPct: number // ours is Prime, theirs isn't → we may sit this % above them
}

export const STRATEGIES: Record<Strategy, StrategyParams> = {
  CONSERVATIVE: { raisePct: 2, lowerPct: 1, undercut: () => 0.01, maxDailyPct: 3, slowNoSaleDays: 14, staleNoSaleDays: 28, targetCoverDays: 45, cooldownHours: 72, minFeedback: 95, primePremiumPct: 5 },
  STANDARD:     { raisePct: 3, lowerPct: 2, undercut: (r) => Math.max(0.5, r * 0.005), maxDailyPct: 6, slowNoSaleDays: 10, staleNoSaleDays: 21, targetCoverDays: 30, cooldownHours: 48, minFeedback: 90, primePremiumPct: 3 },
  AGGRESSIVE:   { raisePct: 4, lowerPct: 4, undercut: (r) => r * 0.015, maxDailyPct: 12, slowNoSaleDays: 5, staleNoSaleDays: 14, targetCoverDays: 14, cooldownHours: 24, minFeedback: 0, primePremiumPct: 1.5 },
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
  explanation: string[] // step-by-step plain-English reasoning
  primeEdgePct: number | null // set when our Prime offer is allowed above a non-Prime reference
  weArePrime: boolean | null // null = our offer not in the fetched offer list
  buyBoxPrime: boolean | null // Buy Box offer's Prime status (null = unknown)
  lowestCompPrime: boolean | null
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
  // The catalog sync upserts but never deactivates listings Amazon has removed,
  // so a row not touched since the account's last full catalog sync is a ghost
  // (deleted on Amazon) — skip it. Rows refreshed later (price crons, new
  // listings) have a newer lastSyncedAt and stay in.
  const lastFullSync = await prisma.listingSyncJob.groupBy({
    by: ['accountId'], where: { status: 'COMPLETED' }, _max: { startedAt: true },
  })
  const seenSince = new Map(lastFullSync.map(j => [j.accountId, j._max.startedAt?.getTime() ?? 0]))
  const rawListings = await prisma.sellerListing.findMany({
    where: {
      listingStatus: 'Active', quantity: { gt: 0 }, asin: only ? only.asin : { not: null },
      ...(only ? { accountId: only.accountId } : {}),
    },
    select: { accountId: true, sku: true, asin: true, condition: true, productTitle: true, price: true, maxPrice: true, quantity: true, fulfillmentChannel: true, buyBoxPrice: true, buyBoxSeller: true, buyBoxSyncedAt: true, lastSyncedAt: true },
  })
  const listings = rawListings.filter(l => l.lastSyncedAt.getTime() >= (seenSince.get(l.accountId) ?? 0))
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
    select: { accountId: true, asin: true, itemCondition: true, isMyOffer: true, landedPrice: true, shippingPrice: true, isBuyBoxWinner: true, isPrime: true, feedbackRating: true, lastFetchedAt: true },
  })
  const offersByGroup = new Map<string, typeof offers>()
  for (const o of offers) {
    // Older than 48 h ⇒ not trustworthy for pricing (prices + Prime flags move); the
    // hourly refresh keeps active pairs < ~1 day old, so stale rows mean "no data".
    if (now - o.lastFetchedAt.getTime() > 48 * 3_600_000) continue
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
    // (speedWhy = the plain-English test that put it in this bucket)
    const sName = strategy.charAt(0) + strategy.slice(1).toLowerCase()
    const accelerating = units7d >= 2 && units7d / 7 > 1.5 * (units30d / 30)
    let speed: Speed
    let speedWhy: string
    if (noSale >= P.staleNoSaleDays) {
      speed = 'STALE'
      speedWhy = `${daysSinceLastSale == null ? 'It has no sales on record' : `It hasn't sold in ${daysSinceLastSale} days`}, which ${sName} treats as stale (no sale in ${P.staleNoSaleDays}+ days).`
    } else if (daysOfCover != null && daysOfCover < P.targetCoverDays / 2) {
      speed = 'HOT'
      speedWhy = `At this pace the stock lasts only about ${daysOfCover} days — under half of ${sName}'s ${P.targetCoverDays}-day target — so it's selling hot.`
    } else if (accelerating) {
      speed = 'HOT'
      speedWhy = `Sales are speeding up: ${units7d} in the last 7 days is well above its 30-day pace, so it's treated as hot.`
    } else if (noSale >= P.slowNoSaleDays) {
      speed = 'SLOW'
      speedWhy = `It hasn't sold in ${daysSinceLastSale} days, which ${sName} treats as slow (no sale in ${P.slowNoSaleDays}+ days).`
    } else if (daysOfCover == null || daysOfCover > P.targetCoverDays * 1.5) {
      speed = 'SLOW'
      speedWhy = `At this pace the stock would last ${daysOfCover == null ? 'indefinitely' : `about ${daysOfCover} days`} — well over ${sName}'s ${P.targetCoverDays}-day target — so it's slow.`
    } else {
      speed = 'HEALTHY'
      speedWhy = `About ${daysOfCover} days of stock at the current pace is close to ${sName}'s ${P.targetCoverDays}-day target, so sales are healthy.`
    }

    // Competition — Buy Box from the 30-min listing refresh when fresh, else offers
    const gOffers = offersByGroup.get(key) ?? []
    const mine = gOffers.find(o => o.isMyOffer)
    const ourShipping = mine ? Number(mine.shippingPrice) : 0
    const comps = gOffers.filter(o => !o.isMyOffer && (o.feedbackRating == null || Number(o.feedbackRating) >= P.minFeedback))
    const lowestCompOffer = comps.length ? comps.reduce((a, b) => (Number(b.landedPrice) < Number(a.landedPrice) ? b : a)) : null
    const lowestCompetitor = lowestCompOffer ? Number(lowestCompOffer.landedPrice) - ourShipping : null
    const weArePrime = mine?.isPrime === true
    const premium = (price: number) => price * (1 + P.primePremiumPct / 100)
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
    // Prime premium: when ours is Prime and the reference offer isn't, the target
    // is that price + the strategy's premium (buyers pay a bit more for Prime).
    let competition: Competition
    const refRaw = !weHoldBuyBox ? (buyBoxPrice ?? lowestCompetitor) : null
    const refOffer = refRaw == null ? null
      : buyBoxPrice != null
        ? (gOffers.find(o => o.isBuyBoxWinner && !o.isMyOffer) ?? comps.find(o => Math.abs(Number(o.landedPrice) - ourShipping - buyBoxPrice!) < 0.01) ?? null)
        : lowestCompOffer
    const primeEdge = refRaw != null && weArePrime && refOffer != null && !refOffer.isPrime
    const ref = refRaw != null && primeEdge ? round2(premium(refRaw)) : refRaw
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
    const adjustments: string[] = [] // plain-English limits applied to the raw target
    let dropped: string | null = null // why a computed move was abandoned
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
      if (target != null && DOWN_ONLY.includes(action) && target >= currentPrice) { target = null; dropped = `we're already at or below ${fmt(ref ?? currentPrice)}, so there's nothing to cut` }
      if (target != null && UP_ONLY.includes(action) && target <= currentPrice) { target = null; dropped = 'there was no room to raise' }
      // When we hold the Buy Box (or are lowest), don't raise past the next competitor.
      if (target != null && target > currentPrice && (weHoldBuyBox || competition === 'LOWEST') && lowestCompetitor != null) {
        // Next seller non-Prime while we're Prime → the cap gets the Prime premium too.
        const capPrime = weArePrime && lowestCompOffer != null && !lowestCompOffer.isPrime
        const capBase = capPrime ? premium(lowestCompetitor) : lowestCompetitor
        const cap = capBase - P.undercut(capBase)
        if (cap <= currentPrice) {
          target = null
          dropped = `there's no room to raise — the next-cheapest seller is at ${fmt(lowestCompetitor)}${capPrime ? ` (non-Prime; ${P.primePremiumPct}% allowance included)` : ''}`
        } else if (cap < target) {
          target = cap; why += ` (capped below next offer ${fmt(lowestCompetitor)})`
          adjustments.push(capPrime
            ? `It's capped at ${fmt(target)}: the next-cheapest seller is at ${fmt(lowestCompetitor)} but isn't Prime, so we can stay up to ${P.primePremiumPct}% above them (${fmt(round2(capBase))}) without handing them the sale.`
            : `It's capped at ${fmt(target)} so we stay just under the next-cheapest seller at ${fmt(lowestCompetitor)} and don't hand them the sale.`)
        }
      }
      if (target != null) {
        const maxMove = currentPrice * P.maxDailyPct / 100
        if (Math.abs(target - currentPrice) > maxMove) {
          const raw = target
          target = currentPrice + Math.sign(target - currentPrice) * maxMove; why += ` (limited to ${P.maxDailyPct}%/day)`
          adjustments.push(`The full move would be to ${fmt(raw)}, but ${sName} changes price by at most ${P.maxDailyPct}% per step, so this step stops at ${fmt(round2(target))}; the feed can suggest the next step after the cooldown.`)
        }
        const ceiling = g.rows.map(r => (r.maxPrice != null ? Number(r.maxPrice) : null)).filter((p): p is number => p != null)
        if (ceiling.length && target > Math.min(...ceiling)) {
          target = Math.min(...ceiling); why += ' (max price)'
          adjustments.push(`It's held to the listing's max price of ${fmt(target)}.`)
        }
        target = round2(target)
        if (Math.abs(target - currentPrice) / currentPrice * 100 < MIN_CHANGE_PCT) { target = null; dropped = `the change would be under ${MIN_CHANGE_PCT}% — too small to be worth it` }
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

    // ── Plain-English explanation, step by step ──────────────────────────────
    const marginCurrent = span(skus.map(s => s.marginCurrent))
    const marginSuggested = span(skus.map(s => s.marginSuggested))
    const cond = g.itemCondition
    const pctTxt = (m: { min: number | null; max: number | null }) => m.min == null ? '—' : m.min === m.max ? `${m.min.toFixed(1)}%` : `${m.min.toFixed(1)}–${m.max!.toFixed(1)}%`
    const explanation: string[] = []
    explanation.push(
      `${g.rows.length > 1 ? `Across its ${g.rows.length} SKUs (a sale on any of them counts for all, since Amazon picks which one sells)` : 'This SKU'} sold ${units7d} in the last 7 days and ${units30d} in the last 30, with ${stock} in stock.`,
    )
    explanation.push(speedWhy)
    if (noData) {
      explanation.push(`We don't have competitor data for this ${cond} ASIN yet, so there's no suggestion until the hourly competitor refresh pulls it.`)
    } else {
      const holder = buyBoxHolder && buyBoxHolder !== 'Competitor' && buyBoxHolder !== 'You' ? buyBoxHolder : 'A competitor'
      const gapTxt = currentPrice != null && ref != null ? `${fmt(currentPrice - ref)} (${((currentPrice - ref) / ref * 100).toFixed(1)}%)` : ''
      const primeTxt = primeEdge ? ` with a non-Prime offer; ours is Prime, so ${sName} lets us sit up to ${P.primePremiumPct}% above it — an effective target of ${fmt(ref!)}` : ''
      const refWho = refRaw == null ? '' : buyBoxPrice != null ? `${holder} holds the Buy Box at ${fmt(refRaw)}${primeTxt}` : `The cheapest other ${cond} seller is at ${fmt(refRaw)}${primeTxt}`
      explanation.push(
        competition === 'WINNING' ? `We currently hold the Buy Box at ${fmt(currentPrice ?? 0)}.${lowestCompetitor != null ? ` The next-cheapest ${cond} seller is at ${fmt(lowestCompetitor)}.` : ' No other seller is competing on price.'}`
        : competition === 'LOWEST' ? (primeEdge
            ? `${refWho}. At ${fmt(currentPrice ?? 0)} we're within that Prime allowance, so price isn't what's holding us back.`
            : `We're already the cheapest ${cond} offer at ${fmt(currentPrice ?? 0)} (next is ${fmt(ref!)}), but we don't hold the Buy Box — so price isn't what's holding us back.`)
        : competition === 'CLOSE' ? `${refWho}; we're only ${gapTxt} above ${primeEdge ? 'that' : 'it'}, so we're close.`
        : competition === 'LOSING' ? `${refWho}; we're ${gapTxt} above ${primeEdge ? 'that' : 'it'}, so we're losing sales on price.`
        : `No other seller has a ${cond} offer on this ASIN right now.`,
      )
      const holdWhy: Partial<Record<string, string>> = {
        'HOT+CLOSE': "It's selling fast even without the Buy Box, so there's no reason to cut the price — hold.",
        'HOT+LOSING': "It's selling fast even without the Buy Box, so there's no reason to cut the price — hold.",
        'HEALTHY+LOWEST': "Sales are healthy and we're already the cheapest, so hold.",
        'HEALTHY+ALONE': 'Sales are healthy with no competition, so hold.',
        'SLOW+WINNING': "We already hold the Buy Box, so a cut is unlikely to add sales yet — hold.",
        'SLOW+LOWEST': "We're already the cheapest, so cutting further is unlikely to help — hold.",
      }
      const actionTxt: Record<Action, string> = {
        RAISE: `Since it's selling fast and ${weHoldBuyBox ? 'we hold the Buy Box' : 'nobody is competing'}, there's room to earn more: ${sName} raises the price ${P.raisePct}%.`,
        PROBE: `${competition === 'LOWEST' ? "Since it's selling fast at the lowest price" : 'Since sales are healthy and we hold the Buy Box'}, ${sName} tests a small ${P.raisePct / 2}% increase to see if the market will take it.`,
        HOLD: holdWhy[rule] ?? 'The rules call for holding the current price.',
        MATCH: `To win back sales, ${sName} ${primeEdge ? 'moves to the Prime-adjusted target of' : 'matches the Buy Box at'} ${fmt(ref ?? 0)}.`,
        PARTWAY: `${sName} moves halfway toward ${primeEdge ? 'the Prime-adjusted target' : 'the Buy Box'} (${fmt(ref ?? 0)}) to compete without giving up too much margin.`,
        UNDERCUT: `To take the Buy Box and get it moving, ${sName} undercuts ${primeEdge ? 'the Prime-adjusted target of ' : ''}${fmt(ref ?? 0)} by ${fmt(P.undercut(ref ?? 0))}.`,
        LOWER: `To get it moving, ${sName} lowers the price ${P.lowerPct}%.`,
        LOWER2: `With no competition and no sales, ${sName} lowers the price ${2 * P.lowerPct}% to find demand.`,
      }
      explanation.push(actionTxt[action])
      explanation.push(...adjustments)
      if (target == null && dropped) explanation.push(`No change is suggested because ${dropped}.`)
      if (target != null && currentPrice != null) {
        explanation.push(`Suggested: ${fmt(currentPrice)} → ${fmt(target)} (${changePct! > 0 ? '+' : ''}${changePct}%).`)
        explanation.push(marginCurrent.min != null
          ? `Net margin goes from ${pctTxt(marginCurrent)} to ${pctTxt(marginSuggested)}${g.rows.length > 1 ? ' across the SKUs' : ''}.`
          : "Margin isn't shown because the SKU isn't mapped to a product with a known cost and a calculation template.")
      }
      const hoursLeft = (t: number) => Math.max(1, Math.round((t - now) / 3_600_000))
      if (status === 'SNOOZED' && snooze?.snoozeUntil) explanation.push(`You rejected this same suggestion${snooze.decidedBy ? ` (${snooze.decidedBy})` : ''}, so it's snoozed for another ${hoursLeft(snooze.snoozeUntil.getTime())} hours.`)
      if (status === 'COOLDOWN') explanation.push(`The price was changed recently; ${sName} waits ${P.cooldownHours} hours between changes to see how sales respond (${hoursLeft(cooldownEnd)} hours left).`)
    }

    out.push({
      key, accountId: g.accountId, asin: g.asin, itemCondition: g.itemCondition,
      title: g.rows.find(r => r.productTitle)?.productTitle ?? null,
      strategy, skus, currentPrice, stock, units7d, units30d, daysSinceLastSale, daysOfCover,
      buyBoxPrice, buyBoxHolder, weHoldBuyBox, lowestCompetitor: lowestCompetitor != null ? round2(lowestCompetitor) : null,
      competitorCount: comps.length, offersFetchedAt,
      speed, competition, rule, action, suggestedPrice: target, changePct,
      marginCurrent, marginSuggested,
      reason, explanation, status, primeEdgePct: primeEdge ? P.primePremiumPct : null,
      weArePrime: mine ? mine.isPrime : null,
      buyBoxPrime: weHoldBuyBox ? (mine ? mine.isPrime : null) : (buyBoxPrice != null && refOffer ? refOffer.isPrime : null),
      lowestCompPrime: lowestCompOffer ? lowestCompOffer.isPrime : null,
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
