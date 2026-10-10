/**
 * Amazon listing uptime: asks Amazon (Listings Items API) whether each SKU is
 * actually live — BUYABLE with available quantity > 0 — and logs only the
 * up/down transitions to listing_uptime_events (the first observation of a SKU
 * is logged too; it marks when tracking began). Catches listings we closed,
 * suspended, or Amazon suppressed, plus sell-outs — which internal stock can't.
 *
 * Also keeps SellerListing.listingStatus / quantity current, and marks SKUs
 * Amazon no longer has (404) as inactive.
 *
 * Scope: Active listings + every SKU mapped on Marketplace SKUs (so we see when
 * a mapped SKU goes live). Stalest-checked first, time-budgeted per run;
 * getListingsItem allows ~5 req/s, so 2 workers stay under it.
 */
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'
import { fulfillmentQtyFromAttributes } from './listings'

interface ListingItemLite {
  summaries?: { marketplaceId: string; status?: string[] }[]
  attributes?: Record<string, unknown>
}

export async function checkListingUptime(opts: { budgetMs?: number } = {}): Promise<{ checked: number; wentLive: number; wentDown: number; errors: number; remaining: number }> {
  const started = Date.now()
  const budgetMs = opts.budgetMs ?? 200_000

  const mapped = await prisma.productGradeMarketplaceSku.findMany({ where: { marketplace: 'amazon' }, select: { sellerSku: true } })
  const rows = await prisma.sellerListing.findMany({
    where: { OR: [{ listingStatus: 'Active' }, { sku: { in: Array.from(new Set(mapped.map(m => m.sellerSku))) } }] },
    select: { id: true, accountId: true, sku: true, isLive: true },
    orderBy: [{ uptimeCheckedAt: { sort: 'asc', nulls: 'first' } }],
  })
  if (rows.length === 0) return { checked: 0, wentLive: 0, wentDown: 0, errors: 0, remaining: 0 }

  const accounts = new Map<string, { sellerId: string; marketplaceId: string; client: SpApiClient } | null>()
  const getAccount = async (id: string) => {
    if (!accounts.has(id)) {
      const a = await prisma.amazonAccount.findUnique({ where: { id }, select: { sellerId: true, marketplaceId: true } })
      accounts.set(id, a ? { ...a, client: new SpApiClient(id) } : null)
    }
    return accounts.get(id) ?? null
  }

  let i = 0, checked = 0, wentLive = 0, wentDown = 0, errors = 0
  const worker = async () => {
    while (i < rows.length && Date.now() - started < budgetMs) {
      const r = rows[i++]
      const acc = await getAccount(r.accountId)
      if (!acc) { errors++; continue }
      let live = false
      let reason = 'NOT_BUYABLE'
      let qty: number | null = null
      try {
        const item = await acc.client.get<ListingItemLite>(
          `/listings/2021-08-01/items/${acc.sellerId}/${encodeURIComponent(r.sku)}`,
          { marketplaceIds: acc.marketplaceId, includedData: 'summaries,attributes' },
        )
        const summary = item.summaries?.find(s => s.marketplaceId === acc.marketplaceId) ?? item.summaries?.[0]
        const buyable = summary?.status?.includes('BUYABLE') ?? false
        qty = fulfillmentQtyFromAttributes(item.attributes)
        live = buyable && (qty == null || qty > 0)
        reason = !buyable ? 'NOT_BUYABLE' : live ? 'BUYABLE' : 'NO_QTY'
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/\b404\b|NOT_FOUND/.test(msg)) { live = false; reason = 'NOT_FOUND'; qty = 0 }
        else { errors++; continue } // transient — leave state unchanged, retry next run
      }
      checked++
      const now = new Date()
      await prisma.sellerListing.update({
        where: { id: r.id },
        data: {
          isLive: live, uptimeCheckedAt: now,
          listingStatus: live ? 'Active' : 'Inactive',
          ...(qty != null ? { quantity: qty } : {}),
        },
      })
      if (r.isLive !== live) {
        await prisma.listingUptimeEvent.create({ data: { accountId: r.accountId, sku: r.sku, at: now, live, reason } })
        if (r.isLive != null) { if (live) wentLive++; else wentDown++ }
      }
    }
  }
  await Promise.all([worker(), worker()])
  return { checked, wentLive, wentDown, errors, remaining: Math.max(0, rows.length - i) }
}

/**
 * Per-SKU uptime intervals reconstructed from transition events.
 * trackedSince = first observation; intervals end at `now` if still live.
 */
export async function loadUptime(skus: string[], now = Date.now()): Promise<Map<string, { trackedSince: number; intervals: [number, number][] }>> {
  const out = new Map<string, { trackedSince: number; intervals: [number, number][] }>()
  if (skus.length === 0) return out
  const events = await prisma.listingUptimeEvent.findMany({
    where: { sku: { in: skus } },
    orderBy: [{ sku: 'asc' }, { at: 'asc' }],
    select: { sku: true, at: true, live: true },
  })
  for (const e of events) {
    const t = e.at.getTime()
    const cur = out.get(e.sku) ?? { trackedSince: t, intervals: [] as [number, number][] }
    const last = cur.intervals[cur.intervals.length - 1]
    if (e.live) { if (!last || last[1] !== Infinity) cur.intervals.push([t, Infinity]) }
    else if (last && last[1] === Infinity) last[1] = t
    out.set(e.sku, cur)
  }
  for (const v of Array.from(out.values())) for (const iv of v.intervals) if (iv[1] === Infinity) iv[1] = now
  return out
}
