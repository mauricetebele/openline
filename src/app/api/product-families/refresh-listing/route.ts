/**
 * POST /api/product-families/refresh-listing  { mskuId }
 * Re-pull one mapped listing's live price + status + Buy Box (Amazon) / BackBox
 * (Back Market) and return the updated values. Used to auto-refresh a row a few
 * seconds after a price push so the grid reflects the marketplace's live state.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { SpApiClient } from '@/lib/amazon/sp-api'
import { BackMarketClient, deriveBmStatus } from '@/lib/backmarket/client'
import { resolveSellerNames } from '@/lib/amazon/seller-name'

export const dynamic = 'force-dynamic'
const num = (v: unknown): number => (v == null ? NaN : Number(v))

interface ListingItemResponse {
  summaries?: { marketplaceId: string; status?: string[] }[]
  offers?: { marketplaceId?: string; price?: { amount?: string | number } }[]
}
interface ItemOffersResponse {
  payload?: { Offers?: Array<{ SellerId?: string; IsBuyBoxWinner?: boolean; ListingPrice?: { Amount?: number }; Shipping?: { Amount?: number }; LandedPrice?: { Amount?: number } }> }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mskuId } = await req.json().catch(() => ({})) as { mskuId?: string }
  if (!mskuId) return NextResponse.json({ error: 'mskuId is required' }, { status: 400 })

  const msku = await prisma.productGradeMarketplaceSku.findUnique({
    where: { id: mskuId }, select: { marketplace: true, sellerSku: true },
  })
  if (!msku) return NextResponse.json({ error: 'Marketplace SKU not found' }, { status: 404 })

  try {
    if (msku.marketplace === 'amazon') {
      const listing = await prisma.sellerListing.findFirst({ where: { sku: msku.sellerSku }, select: { id: true, sku: true, accountId: true, asin: true } })
      if (!listing) return NextResponse.json({ error: 'Amazon listing not found' }, { status: 404 })
      const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: listing.accountId }, select: { sellerId: true, marketplaceId: true } })
      const client = new SpApiClient(listing.accountId)

      const item = await client.get<ListingItemResponse>(
        `/listings/2021-08-01/items/${account.sellerId}/${encodeURIComponent(listing.sku)}`,
        { marketplaceIds: account.marketplaceId, includedData: 'summaries,offers' },
      )
      const summary = item.summaries?.find(s => s.marketplaceId === account.marketplaceId) ?? item.summaries?.[0]
      const listingStatus = summary?.status?.includes('BUYABLE') ? 'Active' : 'Inactive'
      const offer = item.offers?.find(o => o.marketplaceId === account.marketplaceId) ?? item.offers?.[0]
      const amount = num(offer?.price?.amount)

      let buyBoxPrice: number | null = null
      let buyBoxSeller: string | null = null
      if (listing.asin) {
        try {
          const offers = await client.get<ItemOffersResponse>(
            `/products/pricing/v0/items/${encodeURIComponent(listing.asin)}/offers`,
            { MarketplaceId: account.marketplaceId, ItemCondition: 'New', CustomerType: 'Consumer' },
          )
          const win = offers.payload?.Offers?.find(o => o.IsBuyBoxWinner)
          if (win) {
            buyBoxPrice = win.LandedPrice?.Amount ?? ((win.ListingPrice?.Amount ?? 0) + (win.Shipping?.Amount ?? 0))
            const sid = win.SellerId ?? null
            if (sid && sid === account.sellerId) buyBoxSeller = 'You'
            else if (sid) {
              const prof = await prisma.sellerProfile.findUnique({ where: { sellerId: sid }, select: { name: true } })
              buyBoxSeller = prof?.name ?? sid
              if (!prof?.name) resolveSellerNames([sid], account.marketplaceId).catch(() => {})
            }
          }
        } catch { /* buy box best-effort */ }
      }

      await prisma.sellerListing.update({
        where: { id: listing.id },
        data: { listingStatus, ...(Number.isFinite(amount) ? { price: amount } : {}), buyBoxPrice, buyBoxSeller, buyBoxSyncedAt: new Date(), lastSyncedAt: new Date() },
      })
      return NextResponse.json({ mskuId, marketplace: 'amazon', price: Number.isFinite(amount) ? amount : null, listingStatus, buyBoxPrice, buyBoxSeller })
    }

    if (msku.marketplace === 'backmarket') {
      const listing = await prisma.marketplaceListing.findFirst({ where: { marketplace: 'backmarket', sellerSku: msku.sellerSku, accountId: null }, select: { id: true, bmListingRef: true } })
      if (!listing) return NextResponse.json({ error: 'Back Market listing not found' }, { status: 404 })
      if (listing.bmListingRef == null) return NextResponse.json({ error: 'No Back Market listing id — run a Back Market sync first' }, { status: 400 })
      const cred = await prisma.backMarketCredential.findFirst({ where: { isActive: true } })
      if (!cred) return NextResponse.json({ error: 'No active Back Market credential' }, { status: 400 })
      const client = new BackMarketClient(decrypt(cred.apiKeyEnc))

      const live = await client.getListing(listing.bmListingRef)
      const priceNum = num(live.price)
      const price = Number.isFinite(priceNum) ? priceNum : null
      const qtyNum = num(live.quantity)
      const quantity = Number.isFinite(qtyNum) ? qtyNum : null
      const listingStatus = deriveBmStatus(live.publication_state, live.quantity) ?? null

      let backboxWon: boolean | null = null
      let backboxPrice: number | null = null
      if (live.id) {
        try {
          const comps = await client.getBackboxCompetitors(live.id)
          const mine = comps.find(c => c.listing_id === live.id)
          backboxWon = mine?.is_winning === true
          const winner = comps.find(c => c.is_winning) ?? comps[0]
          const wp = num(winner?.winner_price?.amount)
          backboxPrice = Number.isFinite(wp) ? wp : null
        } catch { /* BackBox best-effort */ }
      }

      await prisma.marketplaceListing.update({
        where: { id: listing.id },
        data: { ...(price != null ? { price } : {}), ...(quantity != null ? { quantity } : {}), ...(listingStatus != null ? { listingStatus } : {}), backboxWon, backboxPrice, backboxSyncedAt: new Date(), lastSyncedAt: new Date() },
      })
      return NextResponse.json({ mskuId, marketplace: 'backmarket', price, listingStatus, pushingQty: quantity, backboxPrice, backboxWon })
    }

    return NextResponse.json({ error: 'Unsupported marketplace' }, { status: 400 })
  } catch (err) {
    console.error('[refresh-listing]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Refresh failed' }, { status: 500 })
  }
}
