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
import { loadUptime, loadBuyBoxSamples } from '@/lib/amazon/listing-uptime'

export type Strategy = 'CONSERVATIVE' | 'STANDARD' | 'AGGRESSIVE'
export type Speed = 'HOT' | 'HEALTHY' | 'SLOW' | 'STALE' | 'NEW'
export type Competition = 'WINNING' | 'LOWEST' | 'CLOSE' | 'LOSING' | 'ALONE'
type Action = 'RAISE' | 'PROBE' | 'HOLD' | 'MATCH' | 'PARTWAY' | 'UNDERCUT' | 'LOWER' | 'LOWER2'

export interface StrategyParams {
  raisePct: number; lowerPct: number
  undercutPct: number; undercutMin: number // undercut = max(undercutMin $, ref × undercutPct %)
  maxDailyPct: number
  slowNoSaleDays: number; staleNoSaleDays: number
  targetCoverDays: number
  cooldownHours: number
  minFeedback: number // ignore competitors below this positive-feedback %
  primePremiumPct: number // ours is Prime, theirs isn't → we may sit this % above them
}

// Code defaults; rows in repricing_strategy_params override individual values
// (set by applying an AI-insight proposal). See loadStrategies().
export const STRATEGIES: Record<Strategy, StrategyParams> = {
  CONSERVATIVE: { raisePct: 2, lowerPct: 1, undercutPct: 0, undercutMin: 0.01, maxDailyPct: 3, slowNoSaleDays: 14, staleNoSaleDays: 28, targetCoverDays: 45, cooldownHours: 72, minFeedback: 95, primePremiumPct: 5 },
  STANDARD:     { raisePct: 3, lowerPct: 2, undercutPct: 0.5, undercutMin: 0.5, maxDailyPct: 6, slowNoSaleDays: 10, staleNoSaleDays: 21, targetCoverDays: 30, cooldownHours: 48, minFeedback: 90, primePremiumPct: 3 },
  AGGRESSIVE:   { raisePct: 4, lowerPct: 4, undercutPct: 1.5, undercutMin: 0, maxDailyPct: 12, slowNoSaleDays: 5, staleNoSaleDays: 14, targetCoverDays: 14, cooldownHours: 24, minFeedback: 0, primePremiumPct: 1.5 },
}
export const STRATEGY_PARAM_KEYS = Object.keys(STRATEGIES.STANDARD) as (keyof StrategyParams)[]
export const PARAM_DESCRIPTIONS: Record<keyof StrategyParams, string> = {
  raisePct: 'Raise step % when selling fast / holding the Buy Box',
  lowerPct: 'Lower step % for stale or uncontested items',
  undercutPct: 'Undercut below the Buy Box, % of its price',
  undercutMin: 'Minimum undercut in dollars',
  maxDailyPct: 'Max price change per step, %',
  slowNoSaleDays: 'No sale for this many days = Slow',
  staleNoSaleDays: 'No sale for this many days = Stale',
  targetCoverDays: 'Target days of stock at the current sales pace',
  cooldownHours: 'Wait after an approved change before suggesting again, hours',
  minFeedback: 'Ignore competitors below this positive-feedback %',
  primePremiumPct: 'Allowed % above a non-Prime Buy Box when our offer is Prime',
}
const undercutOf = (P: StrategyParams, ref: number) => Math.max(P.undercutMin, ref * P.undercutPct / 100)

/** Code defaults merged with DB overrides. */
export async function loadStrategies(): Promise<Record<Strategy, StrategyParams>> {
  const rows = await prisma.repricingStrategyParam.findMany()
  const out = JSON.parse(JSON.stringify(STRATEGIES)) as Record<Strategy, StrategyParams>
  for (const r of rows) {
    const s = r.strategy as Strategy
    if (out[s] && (STRATEGY_PARAM_KEYS as string[]).includes(r.param)) out[s][r.param as keyof StrategyParams] = Number(r.value)
  }
  return out
}

// LOWEST = we're the cheapest same-condition offer but don't hold the Buy Box.
const MATRIX: Record<Speed, Record<Competition, Action>> = {
  HOT:     { WINNING: 'RAISE',  LOWEST: 'PROBE', CLOSE: 'HOLD',     LOSING: 'HOLD',     ALONE: 'RAISE' },
  HEALTHY: { WINNING: 'PROBE',  LOWEST: 'HOLD',  CLOSE: 'MATCH',    LOSING: 'PARTWAY',  ALONE: 'HOLD' },
  SLOW:    { WINNING: 'HOLD',   LOWEST: 'HOLD',  CLOSE: 'UNDERCUT', LOSING: 'MATCH',    ALONE: 'LOWER' },
  STALE:   { WINNING: 'LOWER',  LOWEST: 'LOWER', CLOSE: 'UNDERCUT', LOSING: 'UNDERCUT', ALONE: 'LOWER2' },
  // Just listed / restocked, no sale yet: don't mark down for lack of sales;
  // only correct an obvious overprice vs the Buy Box.
  NEW:     { WINNING: 'HOLD',   LOWEST: 'HOLD',  CLOSE: 'HOLD',     LOSING: 'MATCH',    ALONE: 'HOLD' },
}
const DOWN_ONLY: Action[] = ['MATCH', 'PARTWAY', 'UNDERCUT', 'LOWER', 'LOWER2']
const UP_ONLY: Action[] = ['RAISE', 'PROBE']

const CLOSE_GAP_PCT = 2
const MIN_CHANGE_PCT = 0.25
const SNOOZE_HOURS = 24
const DAY = 86_400_000

const round2 = (n: number) => Math.round(n * 100) / 100

/** Start of the stretch still running at `now` (intervals joined across gaps < `gap`). */
function currentRunStart(ivs: [number, number][], now: number, gap: number): number | null {
  const cur = ivs.filter(([, b]) => b >= now - 60_000)
  if (!cur.length) return null
  let start = Math.min(...cur.map(([a]) => a))
  let changed = true
  while (changed) {
    changed = false
    for (const [a, b] of ivs) if (a < start && b >= start - gap) { start = a; changed = true }
  }
  return start
}

/** Total ms of [a, b] covered by the union of intervals. */
function coveredMs(ivs: [number, number][], a: number, b: number): number {
  if (b <= a || !ivs.length) return 0
  const clipped = ivs.map(([x, y]) => [Math.max(x, a), Math.min(y, b)] as [number, number]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0])
  let total = 0, curA = -Infinity, curB = -Infinity
  for (const [x, y] of clipped) {
    if (x > curB) { if (curB > curA) total += curB - curA; curA = x; curB = y }
    else curB = Math.max(curB, y)
  }
  if (curB > curA) total += curB - curA
  return total
}

export interface VelocityScore {
  score: number | null // adjusted units per 24 h live (blended with the baseline)
  raw: number | null // units ÷ live days, unadjusted
  units: number
  liveDays: number
  estimatedPct: number // share of live time estimated from stock history (no Amazon tracking yet)
  confidence: 'low' | 'medium' | 'high'
  baseline: number | null // prior used for the adjustment (median of similar listings)
  target: number | null // stock ÷ strategy target days
  atPrice: { score: number | null; units: number; liveDays: number; since: string } | null
  buyBoxShare: number | null // % of live checks where we held the Buy Box
  buyBoxChecks: number
}

/**
 * Price endings: snap to the nearest X.49 or X.95 (up or down), staying within
 * [lo, hi] — e.g. an undercut must stay under the competitor. Null if no .49/.95
 * price fits the bounds.
 */
export function prettyPrice(x: number, lo = 0, hi = Infinity): number | null {
  const base = Math.floor(x)
  const cands: number[] = []
  for (let d = base - 1; d <= base + 1; d++) cands.push(round2(d + 0.49), round2(d + 0.95))
  const ok = cands.filter(c => c > 0 && c >= lo - 1e-9 && c <= hi + 1e-9)
  if (!ok.length) return null
  return ok.reduce((best, c) => (Math.abs(c - x) < Math.abs(best - x) ? c : best))
}
const pgKey = (p: string, g: string | null) => `${p}:${g ?? ''}`
export const groupKeyOf = (accountId: string, asin: string, itemCondition: string) => `${accountId}|${asin}|${itemCondition}`

export interface FeedSku {
  sku: string; grade: string | null; channel: string; price: number | null; qty: number
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
  liveSince: string | null // when the current stock became sellable / listing first went live
  daysLive: number | null
  liveReason: 'listed' | 'restocked' | 'amazon' | null // 'amazon' = observed via Amazon uptime tracking
  unitsSinceLive: number
  velocity: VelocityScore
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
  const strategies = await loadStrategies()

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
    select: { accountId: true, sku: true, asin: true, condition: true, productTitle: true, price: true, maxPrice: true, quantity: true, fulfillmentChannel: true, buyBoxPrice: true, buyBoxSeller: true, buyBoxSyncedAt: true, lastSyncedAt: true, createdAt: true, priceChangedAt: true },
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
  // Individual sale lines (30 d) — to count sales since a group went live.
  const saleLines = await prisma.$queryRaw<{ sku: string; at: Date; qty: number }[]>`
    SELECT oi."sellerSku" AS sku, o."purchaseDate" AS at, oi."quantityOrdered"::int AS qty
    FROM order_items oi JOIN orders o ON o.id = oi."orderId"
    WHERE o."orderSource" = 'amazon' AND o."workflowStatus" <> 'CANCELLED'
      AND oi."sellerSku" = ANY(${allSkus}::text[]) AND o."purchaseDate" >= now() - interval '30 days'`

  // Amazon product title: the listing's own title when the catalog report had one,
  // else the title on the most recent Amazon order line for that ASIN.
  const orderTitles = await prisma.$queryRaw<{ asin: string; title: string }[]>`
    SELECT DISTINCT ON (oi.asin) oi.asin, oi.title
    FROM order_items oi JOIN orders o ON o.id = oi."orderId"
    WHERE o."orderSource" = 'amazon' AND oi.title IS NOT NULL AND oi.asin = ANY(${asins}::text[])
    ORDER BY oi.asin, o."purchaseDate" DESC`
  const titleByAsin = new Map(orderTitles.map(t => [t.asin, t.title]))

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
    select: { sellerSku: true, productId: true, gradeId: true, calculationTemplateId: true, grade: { select: { grade: true } }, product: { select: { defaultPackagePresetId: true } } },
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
  // ── 4b. "Live since": start of the current unbroken in-stock stretch ───────
  // Rebuilt from unit history per product+grade: each unit is in sellable stock
  // from when it entered (PO receipt, return, repair back, grade/SKU change,
  // unreserved, or a move from a non-sellable bin into a finished-goods one)
  // until it left (sale, FBA/vendor/repair shipment, manual removal, move out of
  // finished goods). Overlapping stretches are joined (gaps < 1 day ignored), so
  // a fast seller that never ran out keeps its full history — only a real
  // sell-out + restock (or a new listing) shortens the window.
  const stockSince = new Map<string, number>()
  const stockIntervals = new Map<string, [number, number][]>() // per product+grade, last 60 d (VelocityScore estimate)
  if (productIds.length) {
    const WINDOW_DAYS = 60
    const winStart = now - WINDOW_DAYS * DAY
    const evRows = await prisma.$queryRaw<{ sid: string; productId: string; gradeId: string | null; inStock: boolean; serialCreated: Date; at: Date | null; kind: string | null }[]>`
      WITH s AS (
        SELECT s.id, s."productId", s."gradeId", s."createdAt",
               (s.status = 'IN_STOCK' AND l."isFinishedGoods" = true) AS "inStock"
        FROM inventory_serials s JOIN locations l ON l.id = s."locationId"
        WHERE s."productId" = ANY(${productIds}::text[])
      ),
      ev AS (
        SELECT h."inventorySerialId" AS sid, h."createdAt" AS at,
          CASE
            WHEN h."eventType"::text IN ('PO_RECEIPT','MP_RMA_RETURN','FBA_RETURN','WHOLESALE_RMA_RETURN','LEGACY_RMA_RECEIPT',
                                        'REPAIR_RETURNED','MANUAL_ADD','VOID_REINSTATE','SKU_CONVERSION','GRADE_CHANGE','UNASSIGNED')
              OR (h."eventType"::text = 'LOCATION_MOVE' AND COALESCE(fl."isFinishedGoods", false) = false AND COALESCE(tl."isFinishedGoods", false) = true)
              THEN 'IN'
            WHEN h."eventType"::text IN ('SALE','FBA_SHIPMENT','VENDOR_RMA_SHIPPED','REPAIR_SHIPPED','MANUAL_REMOVE','MANUAL_FBA')
              OR (h."eventType"::text = 'LOCATION_MOVE' AND COALESCE(fl."isFinishedGoods", false) = true AND COALESCE(tl."isFinishedGoods", false) = false)
              THEN 'OUT'
          END AS kind
        FROM serial_history h
        JOIN s ON s.id = h."inventorySerialId"
        LEFT JOIN locations fl ON fl.id = h."fromLocationId"
        LEFT JOIN locations tl ON tl.id = h."locationId"
        WHERE h."createdAt" >= ${new Date(winStart)}
      )
      SELECT s.id AS sid, s."productId", s."gradeId", s."inStock", s."createdAt" AS "serialCreated", ev.at, ev.kind
      FROM s LEFT JOIN ev ON ev.sid = s.id AND ev.kind IS NOT NULL
      WHERE s."inStock" OR ev.sid IS NOT NULL
      ORDER BY s.id, ev.at`

    // Per serial → in-stock intervals; per product+grade → list of intervals.
    const intervals = stockIntervals
    const push = (k: string, a: number, b: number) => { if (b > a) intervals.set(k, [...(intervals.get(k) ?? []), [a, b]]) }
    let i = 0
    while (i < evRows.length) {
      const sid = evRows[i].sid
      const k = pgKey(evRows[i].productId, evRows[i].gradeId)
      const inStock = evRows[i].inStock
      const created = new Date(evRows[i].serialCreated).getTime()
      let open: number | null = null
      let sawEvent = false
      for (; i < evRows.length && evRows[i].sid === sid; i++) {
        const e = evRows[i]
        if (!e.at || !e.kind) continue
        const t = new Date(e.at).getTime()
        if (e.kind === 'IN') open = t
        else { push(k, open ?? (sawEvent ? t : Math.max(created, winStart)), t); open = null }
        sawEvent = true
      }
      if (inStock) push(k, open ?? (sawEvent ? now : Math.max(created, winStart)), now)
    }

    // Start of the stretch that's still running now.
    for (const [k, list] of Array.from(intervals.entries())) {
      const current = list.filter(([, b]) => b >= now)
      if (!current.length) continue
      let start = Math.min(...current.map(([a]) => a))
      let changed = true
      while (changed) {
        changed = false
        for (const [a, b] of list) {
          if (a < start && b >= start - DAY) { start = a; changed = true }
        }
      }
      stockSince.set(k, start)
    }
  }
  // Listing first seen — meaningful only for listings created after the initial catalog import.
  const firstImport = rawListings.reduce((m, l) => Math.min(m, l.createdAt.getTime()), Infinity)
  // Amazon listing uptime (cron/listing-uptime transitions) per SKU.
  const uptime = await loadUptime(allSkus, now)
  const VS_WINDOW = 30 * DAY
  const vsFrom = now - VS_WINDOW
  const bbSamples = await loadBuyBoxSamples(allSkus, new Date(vsFrom))

  // ── VelocityScore™: units sold per 24 h of live time on Amazon ─────────────
  // Live time = real Amazon uptime (BUYABLE + qty) since tracking began for the
  // group, plus — for the part of the 30-day window before tracking — the
  // in-stock timeline as an estimate. Pooled across the group's SKUs.
  type G = typeof groups extends Map<string, infer V> ? V : never
  const velocityOf = (g: G, from: number) => {
    const ups = g.rows.map(r => uptime.get(r.sku)).filter((u): u is NonNullable<typeof u> => !!u)
    const trackedSince = ups.length ? Math.min(...ups.map(u => u.trackedSince)) : null
    const split = trackedSince != null ? Math.max(from, Math.min(trackedSince, now)) : now
    const realMs = coveredMs(ups.flatMap(u => u.intervals), split, now)
    // Estimate before tracking: union of the group's product+grade in-stock stretches;
    // no serial history → assume live since the listing appeared.
    const pgs = Array.from(new Set(g.rows.map(r => { const m = mskuBySku.get(r.sku); return m ? pgKey(m.productId, m.gradeId) : null }).filter((k): k is string => !!k)))
    const est = pgs.flatMap(k => stockIntervals.get(k) ?? [])
    const listed = Math.min(...g.rows.map(r => r.createdAt.getTime()))
    const estIvs: [number, number][] = est.length ? est : [[Math.max(from, listed), now]]
    const estMs = coveredMs(estIvs, from, split)
    const skus = new Set(g.rows.map(r => r.sku))
    const units = saleLines.filter(s => skus.has(s.sku) && s.at.getTime() >= from).reduce((a, s) => a + s.qty, 0)
    const liveDays = (realMs + estMs) / DAY
    return { units, liveDays, estDays: estMs / DAY, raw: liveDays > 0 ? units / liveDays : null }
  }
  // Baseline (prior) per Amazon condition: median raw score of groups with ≥ 7 live days.
  const priorByCond = new Map<string, number>()
  {
    const byCond = new Map<string, number[]>()
    for (const g of Array.from(groups.values())) {
      const v = velocityOf(g, vsFrom)
      if (v.raw != null && v.liveDays >= 7) byCond.set(g.itemCondition, [...(byCond.get(g.itemCondition) ?? []), v.raw])
    }
    for (const [c, xs] of Array.from(byCond.entries())) { xs.sort((a, b) => a - b); priorByCond.set(c, xs[Math.floor(xs.length / 2)]) }
  }
  const PRIOR_DAYS = 3

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
    const P = strategies[strategy]

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

    // Live since: latest of (oldest current unit's entry into sellable stock,
    // listing first seen if created after the initial import). Null = unknown.
    // Group-level: the group has stock whenever ANY of its product+grades does, so
    // join all their in-stock stretches before finding the current one.
    const groupPgs = Array.from(new Set(g.rows.map(r => { const m = mskuBySku.get(r.sku); return m ? pgKey(m.productId, m.gradeId) : null }).filter((k): k is string => !!k)))
    const stockStart = groupPgs.some(k => stockSince.has(k))
      ? currentRunStart(groupPgs.flatMap(k => stockIntervals.get(k) ?? []), now, DAY)
      : null
    const listedAt = Math.min(...g.rows.map(r => r.createdAt.getTime()))
    const listedStart = listedAt > firstImport + 2 * DAY ? listedAt : null
    const estimate = stockStart != null || listedStart != null ? Math.max(stockStart ?? 0, listedStart ?? 0) : null

    // Amazon uptime (source of truth): start of the current unbroken stretch in
    // which ANY SKU in the group was live (BUYABLE + qty) — gaps < 2 h ignored.
    // Only used when we actually saw it come up (after tracking began);
    // otherwise fall back to the inventory/listing estimate.
    let amazonStart: number | null = null
    const ups = g.rows.map(r => uptime.get(r.sku)).filter((u): u is NonNullable<typeof u> => !!u)
    if (ups.length) {
      const trackedSince = Math.min(...ups.map(u => u.trackedSince))
      const ivs = ups.flatMap(u => u.intervals)
      const cur = ivs.filter(([, b]) => b >= now - 60_000)
      if (cur.length) {
        let start = Math.min(...cur.map(([a]) => a))
        let changed = true
        while (changed) {
          changed = false
          for (const [a, b] of ivs) if (a < start && b >= start - 2 * 3_600_000) { start = a; changed = true }
        }
        if (start > trackedSince + 60_000) amazonStart = start
      }
    }
    const liveSince = amazonStart ?? estimate
    const daysLive = liveSince != null ? Math.max(0, Math.floor((now - liveSince) / DAY)) : null
    const liveReason: 'listed' | 'restocked' | 'amazon' | null = liveSince == null ? null
      : amazonStart != null ? 'amazon'
      : listedStart != null && liveSince === listedStart ? 'listed' : 'restocked'
    const liveVerb = liveReason === 'amazon' ? 'went live on Amazon' : liveReason === 'listed' ? 'was listed' : 'was restocked'
    const shortLive = daysLive != null && daysLive < 30
    const groupSkus = new Set(g.rows.map(r => r.sku))
    const unitsSinceLive = liveSince != null
      ? saleLines.filter(s => groupSkus.has(s.sku) && s.at.getTime() >= liveSince).reduce((a, s) => a + s.qty, 0)
      : units30d

    // Sales pace over the time it was actually live (when that's under 30 days).
    const pace30 = shortLive ? unitsSinceLive / Math.max(daysLive!, 1) : units30d / 30
    const daily = shortLive ? pace30 : 0.6 * (units7d / 7) + 0.4 * pace30
    const daysOfCover = daily > 0 ? Math.round(stock / daily) : null

    // VelocityScore™ (display; step 2 will price toward the target)
    const v30 = velocityOf(g, vsFrom)
    const baseline = priorByCond.get(g.itemCondition) ?? null
    const vsScore = v30.liveDays + (baseline != null ? PRIOR_DAYS : 0) > 0
      ? (v30.units + (baseline ?? 0) * (baseline != null ? PRIOR_DAYS : 0)) / (v30.liveDays + (baseline != null ? PRIOR_DAYS : 0))
      : null
    const vsConfidence: VelocityScore['confidence'] = v30.liveDays >= 14 && v30.units >= 5 ? 'high' : v30.liveDays >= 5 || v30.units >= 3 ? 'medium' : 'low'
    const priceSince = Math.max(0, ...g.rows.map(r => r.priceChangedAt?.getTime() ?? 0))
    const vAt = priceSince > vsFrom ? velocityOf(g, priceSince) : null
    const bb = g.rows.reduce((acc, r) => { const s = bbSamples.get(r.sku); return s ? { held: acc.held + s.held, known: acc.known + s.known } : acc }, { held: 0, known: 0 })
    const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100)
    const velocity: VelocityScore = {
      score: r2(vsScore), raw: r2(v30.raw), units: v30.units, liveDays: Math.round(v30.liveDays * 10) / 10,
      estimatedPct: v30.liveDays > 0 ? Math.round(v30.estDays / v30.liveDays * 100) : 0,
      confidence: vsConfidence, baseline: r2(baseline),
      target: stock > 0 ? r2(stock / P.targetCoverDays) : null,
      atPrice: vAt ? { score: r2(vAt.raw), units: vAt.units, liveDays: Math.round(vAt.liveDays * 10) / 10, since: new Date(priceSince).toISOString() } : null,
      buyBoxShare: bb.known ? Math.round(bb.held / bb.known * 100) : null, buyBoxChecks: bb.known,
    }

    // Speed — "no sale" days only count while the group was live.
    const noSale = daysLive != null ? Math.min(daysSinceLastSale ?? Infinity, daysLive) : (daysSinceLastSale ?? Infinity)
    const noSaleTxt = daysLive != null && (daysSinceLastSale == null || daysSinceLastSale > daysLive)
      ? `It hasn't sold in the ${daysLive} days since it ${liveVerb}`
      : daysSinceLastSale == null ? 'It has no sales on record' : `It hasn't sold in ${daysSinceLastSale} days`
    // (speedWhy = the plain-English test that put it in this bucket)
    const sName = strategy.charAt(0) + strategy.slice(1).toLowerCase()
    const accelerating = units7d >= 2 && units7d / 7 > 1.5 * pace30
    let speed: Speed
    let speedWhy: string
    if (daysLive != null && daysLive < P.slowNoSaleDays && unitsSinceLive === 0) {
      speed = 'NEW'
      speedWhy = `It ${liveVerb} only ${daysLive === 0 ? 'today' : `${daysLive} day${daysLive === 1 ? '' : 's'} ago`} and hasn't sold yet — too early to judge (${sName} waits ${P.slowNoSaleDays} days before calling a listing slow), so we don't cut the price for lack of sales.`
    } else if (noSale >= P.staleNoSaleDays) {
      speed = 'STALE'
      speedWhy = `${noSaleTxt}, which ${sName} treats as stale (no sale in ${P.staleNoSaleDays}+ days).`
    } else if (daysOfCover != null && daysOfCover < P.targetCoverDays / 2) {
      speed = 'HOT'
      speedWhy = `At this pace the stock lasts only about ${daysOfCover} days — under half of ${sName}'s ${P.targetCoverDays}-day target — so it's selling hot.`
    } else if (accelerating) {
      speed = 'HOT'
      speedWhy = `Sales are speeding up: ${units7d} in the last 7 days is well above its 30-day pace, so it's treated as hot.`
    } else if (noSale >= P.slowNoSaleDays) {
      speed = 'SLOW'
      speedWhy = `${noSaleTxt}, which ${sName} treats as slow (no sale in ${P.slowNoSaleDays}+ days).`
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
        case 'UNDERCUT': if (ref != null) { target = ref - undercutOf(P, ref); why = `undercut Buy Box ${fmt(ref)}` } break
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
        const cap = capBase - undercutOf(P, capBase)
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
        // Snap to a .49 / .95 ending without crossing the limits this move relies on.
        let hi = Infinity, lo = 0
        if (action === 'UNDERCUT' && ref != null) hi = Math.min(hi, ref - 0.01)
        if ((action === 'MATCH' || action === 'PARTWAY') && ref != null) hi = Math.min(hi, ref)
        if (target > currentPrice && (weHoldBuyBox || competition === 'LOWEST') && lowestCompetitor != null) {
          const capBase = weArePrime && lowestCompOffer != null && !lowestCompOffer.isPrime ? premium(lowestCompetitor) : lowestCompetitor
          hi = Math.min(hi, capBase - undercutOf(P, capBase))
        }
        if (ceiling.length) hi = Math.min(hi, ...ceiling)
        if (DOWN_ONLY.includes(action)) hi = Math.min(hi, currentPrice - 0.01)
        if (UP_ONLY.includes(action)) lo = currentPrice + 0.01
        const raw = round2(target)
        const pretty = prettyPrice(raw, lo, hi)
        if (pretty == null) {
          target = null
          dropped = `no price ending in .49 or .95 fits between ${fmt(lo)} and ${fmt(hi)}`
        } else {
          target = pretty
          if (pretty !== raw) adjustments.push(`Rounded ${pretty > raw ? 'up' : 'down'} from ${fmt(raw)} to ${fmt(pretty)} so the price ends in .49 or .95.`)
          if (Math.abs(target - currentPrice) / currentPrice * 100 < MIN_CHANGE_PCT) { target = null; dropped = `the change would be under ${MIN_CHANGE_PCT}% — too small to be worth it` }
        }
      }
    }
    const changePct = target != null && currentPrice ? round2((target - currentPrice) / currentPrice * 100) : null

    // Per-SKU detail + margins
    const skus: FeedSku[] = g.rows.map(r => {
      const v = velBySku.get(r.sku)
      const price = r.price != null ? Number(r.price) : null
      return {
        sku: r.sku, grade: mskuBySku.get(r.sku)?.grade?.grade ?? null, channel: r.fulfillmentChannel, price, qty: r.quantity,
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

    // No fresh offer list → we don't know who's Prime (incl. us) or who else is
    // competing; the Buy Box price alone isn't enough to price against. Wait for
    // the hourly offer refresh / the Refresh button rather than guess.
    const noData = gOffers.length === 0
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
    if (shortLive && liveSince != null) {
      const d = new Date(liveSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      explanation.push(liveReason === 'amazon'
        ? `Amazon shows it has only been live (buyable with stock) since ${d} (${daysLive} day${daysLive === 1 ? '' : 's'}) — before that the listing was down (closed, suspended, suppressed or sold out) — so its sales pace is measured over that time, not 30 days (${unitsSinceLive} sold since).`
        : liveReason === 'listed'
        ? `It was only listed ${daysLive} day${daysLive === 1 ? '' : 's'} ago (${d}), so its sales pace is measured over those ${Math.max(daysLive!, 1)} day${daysLive === 1 ? '' : 's'}, not 30 (${unitsSinceLive} sold since).`
        : `It's only had stock continuously since ${d} (${daysLive} day${daysLive === 1 ? '' : 's'}) — before that it was sold out — so its sales pace is measured over that time, not 30 days (${unitsSinceLive} sold since).`)
    }
    explanation.push(speedWhy)
    {
      const v = velocity
      const fmtN = (n: number | null) => (n == null ? '—' : n.toFixed(2))
      let line = `VelocityScore™ ${fmtN(v.score)} units per day of uptime: ${v.units} sold over ${v.liveDays} live day${v.liveDays === 1 ? '' : 's'} in the last 30`
      line += v.estimatedPct > 0 ? ` (${v.estimatedPct}% of that uptime estimated from stock history until Amazon tracking builds up)` : ' (all measured from Amazon uptime)'
      line += `; confidence ${v.confidence}${v.confidence === 'low' && v.baseline != null ? ` — blended with the typical ${g.itemCondition} listing (${fmtN(v.baseline)}/day) until there's more data` : ''}.`
      if (v.target != null) line += ` ${sName}'s target is ${fmtN(v.target)}/day (sell the ${stock} in stock in ${P.targetCoverDays} days).`
      if (v.atPrice) line += ` At the current price (since ${new Date(v.atPrice.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}): ${fmtN(v.atPrice.score)}/day over ${v.atPrice.liveDays} live day${v.atPrice.liveDays === 1 ? '' : 's'}.`
      if (v.buyBoxShare != null) line += ` We held the Buy Box in ${v.buyBoxShare}% of live checks (${v.buyBoxChecks}).`
      explanation.push(line)
    }
    if (noData) {
      explanation.push(`We don't have fresh competitor offers (including who's Prime) for this ${cond} ASIN yet${buyBoxPrice != null ? ` — only the Buy Box price of ${fmt(buyBoxPrice)}` : ''}, so there's no suggestion until they're pulled. Click Refresh, or wait for the hourly refresh.`)
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
      // Offer-type comparison when the Prime allowance did NOT apply (so it's clear why).
      if (!primeEdge && refOffer && mine) {
        explanation.push(
          !mine.isPrime && !refOffer.isPrime ? "Neither our offer nor theirs is Prime, so there's no Prime allowance — it's a straight price comparison."
          : !mine.isPrime && refOffer.isPrime ? "Their offer is Prime and ours isn't, so there's no Prime allowance (if this listing should be Prime, check its shipping template)."
          : 'Both offers are Prime, so it\'s a straight price comparison.',
        )
      }
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
        HOLD: holdWhy[rule] ?? (speed === 'NEW' ? 'Give it time to sell at this price before changing anything — hold.' : 'The rules call for holding the current price.'),
        MATCH: `To win back sales, ${sName} ${primeEdge ? 'moves to the Prime-adjusted target of' : 'matches the Buy Box at'} ${fmt(ref ?? 0)}.`,
        PARTWAY: `${sName} moves halfway toward ${primeEdge ? 'the Prime-adjusted target' : 'the Buy Box'} (${fmt(ref ?? 0)}) to compete without giving up too much margin.`,
        UNDERCUT: `To take the Buy Box and get it moving, ${sName} undercuts ${primeEdge ? 'the Prime-adjusted target of ' : ''}${fmt(ref ?? 0)} by ${fmt(undercutOf(P, ref ?? 0))}.`,
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
      title: g.rows.find(r => r.productTitle)?.productTitle ?? titleByAsin.get(g.asin) ?? null,
      strategy, skus, currentPrice, stock, units7d, units30d, daysSinceLastSale, daysOfCover,
      buyBoxPrice, buyBoxHolder, weHoldBuyBox, lowestCompetitor: lowestCompetitor != null ? round2(lowestCompetitor) : null,
      competitorCount: comps.length, offersFetchedAt,
      speed, competition, rule, action, suggestedPrice: target, changePct,
      marginCurrent, marginSuggested,
      reason, explanation, status, primeEdgePct: primeEdge ? P.primePremiumPct : null,
      liveSince: liveSince != null ? new Date(liveSince).toISOString() : null, daysLive, liveReason, unitsSinceLive, velocity,
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
