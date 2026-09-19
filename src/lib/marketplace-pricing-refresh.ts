/**
 * Refresh live price + listing status + Buy Box (Amazon) / BackBox (Back Market)
 * for EVERY sync-enabled marketplace SKU, persisting into SellerListing /
 * MarketplaceListing. Reuses the exact logic from product-families sync-pricing,
 * scoped globally instead of per-family. Driven by the /api/cron/refresh-pricing
 * cron (every 30 min) and callable on demand.
 */
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { SpApiClient } from '@/lib/amazon/sp-api'
import { BackMarketClient, deriveBmStatus } from '@/lib/backmarket/client'
import { resolveSellerNames } from '@/lib/amazon/seller-name'

const AMAZON_CONCURRENCY = 6
const BM_CONCURRENCY = 3
// Per-invocation batch caps. The SP-API pricing (Buy Box) endpoint is hard
// rate-limited (~0.5 req/s per account), so the whole catalogue can't refresh
// inside Vercel's 300s function ceiling. Each cron run refreshes the stalest
// slice (never-synced first); the full set cycles over a few runs.
const AMAZON_BATCH = 45
const BM_BATCH = 60

interface ListingItemResponse {
  summaries?: { marketplaceId: string; status?: string[] }[]
  offers?: { marketplaceId?: string; price?: { amount?: string | number } }[]
}
interface ItemOffersResponse {
  payload?: { Offers?: Array<{
    SellerId?: string; IsBuyBoxWinner?: boolean
    ListingPrice?: { Amount?: number }; Shipping?: { Amount?: number }; LandedPrice?: { Amount?: number }
  }> }
}

async function pool<T>(items: T[], n: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx]) }
  }))
}
const num = (v: unknown): number => (v == null ? NaN : Number(v))

export interface RefreshPricingResult {
  amazon: { total: number; ok: number; err: number }
  backmarket: { total: number; ok: number; err: number }
}

export async function refreshAllPricing(): Promise<RefreshPricingResult> {
  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: { syncQty: true },
    select: { marketplace: true, sellerSku: true },
  })
  const amazonSkus = Array.from(new Set(mskus.filter(m => m.marketplace === 'amazon').map(m => m.sellerSku)))
  const bmSkus = Array.from(new Set(mskus.filter(m => m.marketplace === 'backmarket').map(m => m.sellerSku)))

  const amazonListings = amazonSkus.length ? await prisma.sellerListing.findMany({
    where: { sku: { in: amazonSkus } }, select: { id: true, sku: true, asin: true, accountId: true },
    orderBy: [{ buyBoxSyncedAt: { sort: 'asc', nulls: 'first' } }],
    take: AMAZON_BATCH,
  }) : []
  const bmListings = bmSkus.length ? await prisma.marketplaceListing.findMany({
    where: { marketplace: 'backmarket', sellerSku: { in: bmSkus } }, select: { id: true, sellerSku: true, bmListingRef: true },
    orderBy: [{ backboxSyncedAt: { sort: 'asc', nulls: 'first' } }],
    take: BM_BATCH,
  }) : []

  const stats: RefreshPricingResult = {
    amazon: { total: amazonListings.length, ok: 0, err: 0 },
    backmarket: { total: bmListings.length, ok: 0, err: 0 },
  }

  // ── Amazon phase ────────────────────────────────────────────────────────────
  const amazonPhase = async () => {
    if (amazonListings.length === 0) return
    const accountCache = new Map<string, { sellerId: string; marketplaceId: string; client: SpApiClient } | null>()
    const buyBoxByAsin = new Map<string, Promise<{ price: number | null; seller: string | null } | null>>()
    const uncachedSellers = new Map<string, Set<string>>()

    async function getAccount(accountId: string) {
      if (!accountCache.has(accountId)) {
        try {
          const a = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId }, select: { sellerId: true, marketplaceId: true } })
          accountCache.set(accountId, { ...a, client: new SpApiClient(accountId) })
        } catch { accountCache.set(accountId, null) }
      }
      return accountCache.get(accountId) ?? null
    }

    function getBuyBox(acc: { sellerId: string; marketplaceId: string; client: SpApiClient }, asin: string) {
      const key = `${acc.marketplaceId}:${asin}`
      if (!buyBoxByAsin.has(key)) {
        buyBoxByAsin.set(key, (async () => {
          const offers = await acc.client.get<ItemOffersResponse>(
            `/products/pricing/v0/items/${encodeURIComponent(asin)}/offers`,
            { MarketplaceId: acc.marketplaceId, ItemCondition: 'New', CustomerType: 'Consumer' },
          )
          const win = offers.payload?.Offers?.find(o => o.IsBuyBoxWinner)
          if (!win) return { price: null, seller: null }
          const price = win.LandedPrice?.Amount ?? ((win.ListingPrice?.Amount ?? 0) + (win.Shipping?.Amount ?? 0))
          const sid = win.SellerId ?? null
          let seller: string | null = null
          if (sid && sid === acc.sellerId) seller = 'You'
          else if (sid) {
            const prof = await prisma.sellerProfile.findUnique({ where: { sellerId: sid }, select: { name: true } })
            seller = prof?.name ?? sid
            if (!prof?.name) { const s = uncachedSellers.get(acc.marketplaceId) ?? new Set(); s.add(sid); uncachedSellers.set(acc.marketplaceId, s) }
          }
          return { price, seller }
        })().catch(() => null))
      }
      return buyBoxByAsin.get(key)!
    }

    await pool(amazonListings, AMAZON_CONCURRENCY, async (l) => {
      try {
        const acc = await getAccount(l.accountId)
        if (!acc) throw new Error('Amazon account unavailable')
        const item = await acc.client.get<ListingItemResponse>(
          `/listings/2021-08-01/items/${acc.sellerId}/${encodeURIComponent(l.sku)}`,
          { marketplaceIds: acc.marketplaceId, includedData: 'summaries,offers' },
        )
        const summary = item.summaries?.find(s => s.marketplaceId === acc.marketplaceId) ?? item.summaries?.[0]
        const listingStatus = summary?.status?.includes('BUYABLE') ? 'Active' : 'Inactive'
        const offer = item.offers?.find(o => o.marketplaceId === acc.marketplaceId) ?? item.offers?.[0]
        const amount = num(offer?.price?.amount)
        const bb = l.asin ? await getBuyBox(acc, l.asin) : null
        await prisma.sellerListing.update({
          where: { id: l.id },
          data: {
            listingStatus,
            ...(Number.isFinite(amount) ? { price: amount } : {}),
            ...(bb ? { buyBoxPrice: bb.price, buyBoxSeller: bb.seller, buyBoxSyncedAt: new Date() } : {}),
            lastSyncedAt: new Date(),
          },
        })
        stats.amazon.ok++
      } catch { stats.amazon.err++ }
    })

    for (const [marketplaceId, ids] of Array.from(uncachedSellers.entries())) {
      if (ids.size) resolveSellerNames(Array.from(ids), marketplaceId).catch(() => {})
    }
  }

  // ── Back Market phase ─────────────────────────────────────────────────────────
  const bmPhase = async () => {
    if (bmListings.length === 0) return
    const cred = await prisma.backMarketCredential.findFirst({ where: { isActive: true } })
    if (!cred) { stats.backmarket.err = bmListings.length; return }
    const client = new BackMarketClient(decrypt(cred.apiKeyEnc))
    await pool(bmListings, BM_CONCURRENCY, async (l) => {
      try {
        if (l.bmListingRef == null) throw new Error('No Back Market listing id')
        const live = await client.getListing(l.bmListingRef)
        const price = num(live.price)
        const qty = num(live.quantity)
        const listingStatus = deriveBmStatus(live.publication_state, live.quantity)

        let backboxWon: boolean | undefined
        let backboxPrice: number | undefined
        if (live.id) {
          try {
            const comps = await client.getBackboxCompetitors(live.id)
            const mine = comps.find(c => c.listing_id === live.id)
            backboxWon = mine?.is_winning === true
            const winner = comps.find(c => c.is_winning) ?? comps[0]
            const wp = num(winner?.winner_price?.amount)
            if (Number.isFinite(wp)) backboxPrice = wp
          } catch { /* BackBox unavailable */ }
        }

        await prisma.marketplaceListing.update({
          where: { id: l.id },
          data: {
            ...(Number.isFinite(price) ? { price } : {}),
            ...(Number.isFinite(qty) ? { quantity: qty } : {}),
            ...(listingStatus !== undefined ? { listingStatus } : {}),
            ...(backboxWon !== undefined ? { backboxWon, backboxPrice: backboxPrice ?? null, backboxSyncedAt: new Date() } : {}),
            lastSyncedAt: new Date(),
          },
        })
        stats.backmarket.ok++
      } catch { stats.backmarket.err++ }
    })
  }

  await Promise.all([amazonPhase(), bmPhase()])
  return stats
}
