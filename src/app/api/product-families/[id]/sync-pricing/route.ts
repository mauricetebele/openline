/**
 * GET /api/product-families/[id]/sync-pricing  (Server-Sent Events)
 * Pulls the live price + listing status for every marketplace SKU in the family
 * straight from Amazon (SP-API) and Back Market, updating our stored listings.
 * Streams progress: data: { processed, total, sku, marketplace, status, message }.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { SpApiClient } from '@/lib/amazon/sp-api'
import { BackMarketClient } from '@/lib/backmarket/client'
import { resolveSellerNames } from '@/lib/amazon/seller-name'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface ListingItemResponse {
  summaries?: { marketplaceId: string; status?: string[] }[]
  offers?: { marketplaceId?: string; price?: { amount?: string | number } }[]
}

interface ItemOffersResponse {
  payload?: {
    status?: string
    Offers?: Array<{
      SellerId?: string
      IsBuyBoxWinner?: boolean
      ListingPrice?: { Amount?: number }
      Shipping?: { Amount?: number }
      LandedPrice?: { Amount?: number }
    }>
  }
}

// BackBox row from GET /ws/listings_bi (see api.backmarket.dev GetBackboxData).
interface BmBackbox {
  sku?: string
  price?: number | string
  buybox?: boolean
  price_for_buybox?: number | string
}

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

      send({ processed, total })
      if (total === 0) { send({ processed, total, done: true }); controller.close(); return }

      // ── Amazon: live price + status per SKU via SP-API getListingsItem ──
      const byAccount = new Map<string, typeof amazonListings>()
      for (const l of amazonListings) {
        const list = byAccount.get(l.accountId) ?? []; list.push(l); byAccount.set(l.accountId, list)
      }
      for (const [accountId, listings] of Array.from(byAccount.entries())) {
        let account: { sellerId: string; marketplaceId: string } | null = null
        try { account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId }, select: { sellerId: true, marketplaceId: true } }) } catch { /* handled below */ }
        const client = account ? new SpApiClient(accountId) : null
        // Cache buy box per ASIN so shared-ASIN grades only cost one lookup.
        const buyBoxByAsin = new Map<string, { price: number | null; seller: string | null }>()
        for (const l of listings) {
          try {
            if (!account || !client) throw new Error('Amazon account unavailable')
            const item = await client.get<ListingItemResponse>(
              `/listings/2021-08-01/items/${account.sellerId}/${encodeURIComponent(l.sku)}`,
              { marketplaceIds: account.marketplaceId, includedData: 'summaries,offers' },
            )
            const summary = item.summaries?.find(s => s.marketplaceId === account!.marketplaceId) ?? item.summaries?.[0]
            const listingStatus = summary?.status?.includes('BUYABLE') ? 'Active' : 'Inactive'
            const offer = item.offers?.find(o => o.marketplaceId === account!.marketplaceId) ?? item.offers?.[0]
            const amount = offer?.price?.amount != null ? Number(offer.price.amount) : NaN

            // Buy Box for the mapped ASIN (price + winning seller name).
            let bb: { price: number | null; seller: string | null } | null = null
            if (l.asin) {
              if (buyBoxByAsin.has(l.asin)) {
                bb = buyBoxByAsin.get(l.asin)!
              } else {
                try {
                  const offers = await client.get<ItemOffersResponse>(
                    `/products/pricing/v0/items/${encodeURIComponent(l.asin)}/offers`,
                    { MarketplaceId: account.marketplaceId, ItemCondition: 'New', CustomerType: 'Consumer' },
                  )
                  const win = offers.payload?.Offers?.find(o => o.IsBuyBoxWinner)
                  if (win) {
                    const price = win.LandedPrice?.Amount ?? ((win.ListingPrice?.Amount ?? 0) + (win.Shipping?.Amount ?? 0))
                    const sid = win.SellerId ?? null
                    let seller: string | null = null
                    if (sid && sid === account.sellerId) seller = 'You'
                    else if (sid) { const m = await resolveSellerNames([sid], account.marketplaceId); seller = m.get(sid) ?? sid }
                    bb = { price, seller }
                  } else {
                    bb = { price: null, seller: null }
                  }
                } catch { bb = null }
                if (bb) buyBoxByAsin.set(l.asin, bb)
              }
            }

            await prisma.sellerListing.update({
              where: { id: l.id },
              data: {
                listingStatus,
                ...(Number.isFinite(amount) ? { price: amount } : {}),
                ...(bb ? { buyBoxPrice: bb.price, buyBoxSeller: bb.seller, buyBoxSyncedAt: new Date() } : {}),
                lastSyncedAt: new Date(),
              },
            })
            processed++
            const bbMsg = bb?.price != null ? ` · BB $${bb.price.toFixed(2)}${bb.seller ? ` (${bb.seller})` : ''}` : ''
            send({ processed, total, sku: l.sku, marketplace: 'amazon', status: 'ok', message: `${listingStatus}${Number.isFinite(amount) ? ` · $${amount.toFixed(2)}` : ''}${bbMsg}` })
          } catch (e) {
            processed++
            send({ processed, total, sku: l.sku, marketplace: 'amazon', status: 'error', message: e instanceof Error ? e.message : 'failed' })
          }
        }
      }

      // ── Back Market: one bulk pull, then map each SKU ──
      if (bmListings.length > 0) {
        send({ processed, total, message: 'Fetching Back Market listings…' })
        const cred = await prisma.backMarketCredential.findFirst({ where: { isActive: true } })
        let bmMap = new Map<string, { price?: number | string; quantity?: number | string }>()
        const backboxMap = new Map<string, BmBackbox>()
        try {
          if (!cred) throw new Error('No active Back Market credential')
          const client = new BackMarketClient(decrypt(cred.apiKeyEnc))
          const live = await client.fetchAllPages<{ sku?: string; price?: number | string; quantity?: number | string }>('/listings')
          bmMap = new Map(live.filter(x => x.sku).map(x => [String(x.sku).toUpperCase(), { price: x.price, quantity: x.quantity }]))
          // BackBox competitive data (best-effort — requires BackBox API access).
          try {
            send({ processed, total, message: 'Fetching Back Market BackBox…' })
            const bb = await client.fetchAllPages<BmBackbox>('/listings_bi')
            for (const x of bb) if (x.sku) backboxMap.set(String(x.sku).toUpperCase(), x)
          } catch { /* BackBox unavailable — leave prices as-is */ }
        } catch (e) {
          // Mark all BM SKUs as errored and finish.
          for (const l of bmListings) {
            processed++
            send({ processed, total, sku: l.sellerSku, marketplace: 'backmarket', status: 'error', message: e instanceof Error ? e.message : 'failed' })
          }
          send({ processed, total, done: true }); controller.close(); return
        }
        for (const l of bmListings) {
          try {
            const live = bmMap.get(l.sellerSku.toUpperCase())
            if (!live) throw new Error('Not found on Back Market')
            const qty = live.quantity != null ? Number(live.quantity) : NaN
            const price = live.price != null ? Number(live.price) : NaN
            const listingStatus = Number.isFinite(qty) ? (qty > 0 ? 'Active' : 'Inactive') : undefined

            // BackBox: current backbox price = our price when we hold it, else the price-to-win.
            const bx = backboxMap.get(l.sellerSku.toUpperCase())
            let backboxWon: boolean | undefined
            let backboxPrice: number | undefined
            if (bx) {
              backboxWon = bx.buybox === true
              const cand = backboxWon ? Number(bx.price) : Number(bx.price_for_buybox)
              if (Number.isFinite(cand)) backboxPrice = cand
            }

            await prisma.marketplaceListing.update({
              where: { id: l.id },
              data: {
                ...(Number.isFinite(price) ? { price } : {}),
                ...(listingStatus !== undefined ? { listingStatus } : {}),
                ...(bx ? { backboxWon: backboxWon ?? null, backboxPrice: backboxPrice ?? null, backboxSyncedAt: new Date() } : {}),
                lastSyncedAt: new Date(),
              },
            })
            processed++
            const bxMsg = backboxPrice != null ? ` · BackBox $${backboxPrice.toFixed(2)}${backboxWon ? ' (won)' : ''}` : ''
            send({ processed, total, sku: l.sellerSku, marketplace: 'backmarket', status: 'ok', message: `${listingStatus ?? '?'}${Number.isFinite(price) ? ` · $${price.toFixed(2)}` : ''}${bxMsg}` })
          } catch (e) {
            processed++
            send({ processed, total, sku: l.sellerSku, marketplace: 'backmarket', status: 'error', message: e instanceof Error ? e.message : 'failed' })
          }
        }
      }

      send({ processed, total, done: true })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
