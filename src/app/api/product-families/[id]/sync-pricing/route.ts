/**
 * GET /api/product-families/[id]/sync-pricing  (Server-Sent Events)
 * Pulls live price + status + Buy Box (Amazon) / BackBox (Back Market) for every
 * marketplace SKU in the family and updates our stored listings. Work runs
 * concurrently (bounded pools) across both marketplaces; per-listing BM calls
 * avoid crawling the whole catalog. Streams: data: { processed, total, ... }.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { SpApiClient } from '@/lib/amazon/sp-api'
import { BackMarketClient, deriveBmStatus } from '@/lib/backmarket/client'
import { resolveSellerNames } from '@/lib/amazon/seller-name'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const AMAZON_CONCURRENCY = 6
const BM_CONCURRENCY = 3

interface ListingItemResponse {
  summaries?: { marketplaceId: string; status?: string[] }[]
  offers?: { marketplaceId?: string; price?: { amount?: string | number } }[]
}
interface ItemOffersResponse {
  payload?: { status?: string; Offers?: Array<{
    SellerId?: string; IsBuyBoxWinner?: boolean
    ListingPrice?: { Amount?: number }; Shipping?: { Amount?: number }; LandedPrice?: { Amount?: number }
  }> }
}

/** Bounded-concurrency map — runs `worker` over items, at most `n` in flight. */
async function pool<T>(items: T[], n: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx]) }
  }))
}

const num = (v: unknown): number => (v == null ? NaN : Number(v))

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const products = await prisma.product.findMany({ where: { familyId: params.id }, select: { id: true } })
  const productIds = products.map(p => p.id)

  const mskus = productIds.length ? await prisma.productGradeMarketplaceSku.findMany({
    where: { productId: { in: productIds } },
    select: { marketplace: true, sellerSku: true },
  }) : []

  const amazonSkus = Array.from(new Set(mskus.filter(m => m.marketplace === 'amazon').map(m => m.sellerSku)))
  const bmSkus = Array.from(new Set(mskus.filter(m => m.marketplace === 'backmarket').map(m => m.sellerSku)))

  const amazonListings = amazonSkus.length ? await prisma.sellerListing.findMany({
    where: { sku: { in: amazonSkus } }, select: { id: true, sku: true, accountId: true, asin: true },
  }) : []
  const bmListings = bmSkus.length ? await prisma.marketplaceListing.findMany({
    where: { marketplace: 'backmarket', sellerSku: { in: bmSkus } }, select: { id: true, sellerSku: true, bmListingRef: true },
  }) : []

  const total = amazonListings.length + bmListings.length

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (data: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`))
      let processed = 0
      const tick = (evt: object) => { processed++; send({ processed, total, ...evt }) }

      send({ processed, total })
      if (total === 0) { send({ processed, total, done: true }); controller.close(); return }

      // ── Amazon phase ──────────────────────────────────────────────────────
      const amazonPhase = async () => {
        if (amazonListings.length === 0) return
        // Resolve each account once; cache Buy Box per (account, ASIN) via a shared
        // in-flight promise so concurrent grades don't refetch the same ASIN.
        const accountCache = new Map<string, { sellerId: string; marketplaceId: string; client: SpApiClient } | null>()
        const buyBoxByAsin = new Map<string, Promise<{ price: number | null; seller: string | null } | null>>()
        const uncachedSellers = new Map<string, Set<string>>() // marketplaceId -> sellerIds needing later name resolution

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
                // Cache-only lookup (no blocking network) — resolve names in the background.
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
            const bbMsg = bb?.price != null ? ` · BB $${bb.price.toFixed(2)}${bb.seller ? ` (${bb.seller})` : ''}` : ''
            tick({ sku: l.sku, marketplace: 'amazon', status: 'ok', message: `${listingStatus}${Number.isFinite(amount) ? ` · $${amount.toFixed(2)}` : ''}${bbMsg}` })
          } catch (e) {
            tick({ sku: l.sku, marketplace: 'amazon', status: 'error', message: e instanceof Error ? e.message : 'failed' })
          }
        })

        // Fill in any uncached competitor seller names for next time (non-blocking).
        for (const [marketplaceId, ids] of Array.from(uncachedSellers.entries())) {
          if (ids.size) resolveSellerNames(Array.from(ids), marketplaceId).catch(() => {})
        }
      }

      // ── Back Market phase (per-listing; no full-catalog crawl) ─────────────
      const bmPhase = async () => {
        if (bmListings.length === 0) return
        const cred = await prisma.backMarketCredential.findFirst({ where: { isActive: true } })
        if (!cred) {
          for (const l of bmListings) tick({ sku: l.sellerSku, marketplace: 'backmarket', status: 'error', message: 'No active Back Market credential' })
          return
        }
        const client = new BackMarketClient(decrypt(cred.apiKeyEnc))
        await pool(bmListings, BM_CONCURRENCY, async (l) => {
          try {
            if (l.bmListingRef == null) throw new Error('No Back Market listing id — run a Back Market sync first')
            const live = await client.getListing(l.bmListingRef)
            const price = num(live.price)
            const qty = num(live.quantity)
            const listingStatus = deriveBmStatus(live.publication_state, live.quantity)

            // BackBox competitors (best-effort). winner_price = current BackBox price.
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
              } catch { /* BackBox unavailable — leave as-is */ }
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
            const bxMsg = backboxPrice != null ? ` · BackBox $${backboxPrice.toFixed(2)}${backboxWon ? ' (won)' : ''}` : ''
            tick({ sku: l.sellerSku, marketplace: 'backmarket', status: 'ok', message: `${listingStatus ?? '?'}${Number.isFinite(price) ? ` · $${price.toFixed(2)}` : ''}${bxMsg}` })
          } catch (e) {
            tick({ sku: l.sellerSku, marketplace: 'backmarket', status: 'error', message: e instanceof Error ? e.message : 'failed' })
          }
        })
      }

      // Run both marketplaces concurrently.
      await Promise.all([amazonPhase(), bmPhase()])

      send({ processed, total, done: true })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
