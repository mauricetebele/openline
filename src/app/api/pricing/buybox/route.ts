/**
 * GET /api/pricing/buybox?accountId=X&asin=B0XXXXXXXXX
 *
 * Returns buy box price and seller name for a single ASIN.
 * Always fetches live from SP-API for real-time accuracy.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { SpApiClient } from '@/lib/amazon/sp-api'

export const dynamic = 'force-dynamic'

const ASIN_RE = /^B0[A-Z0-9]{8}$/

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = req.nextUrl.searchParams.get('accountId')?.trim()
  const asin = req.nextUrl.searchParams.get('asin')?.trim()

  if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })
  if (!asin || !ASIN_RE.test(asin)) return NextResponse.json({ error: 'Invalid ASIN' }, { status: 400 })

  // Always fetch live from SP-API
  try {
    const account = await prisma.amazonAccount.findUnique({
      where: { id: accountId },
      select: { marketplaceId: true },
    })
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const client = new SpApiClient(accountId)
    const response = await client.get<{
      payload?: {
        Offers?: Array<{
          SellerId?: string
          IsBuyBoxWinner?: boolean
          ListingPrice?: { Amount?: number }
          LandedPrice?: { Amount?: number }
          IsFulfilledByAmazon?: boolean
          SellerFeedbackRating?: { FeedbackCount?: number }
        }>
      }
    }>(`/products/pricing/v0/items/${asin}/offers`, {
      MarketplaceId: account.marketplaceId,
      ItemCondition: 'New',
      CustomerType: 'Consumer',
    })

    const offers = response?.payload?.Offers ?? []
    const bbWinner = offers.find(o => o.IsBuyBoxWinner)
    const cheapest = [...offers].sort((a, b) =>
      (a.LandedPrice?.Amount ?? 999) - (b.LandedPrice?.Amount ?? 999)
    )[0]

    const best = bbWinner ?? cheapest

    if (!best) {
      return NextResponse.json({ asin, buyBoxPrice: null, sellerName: null, source: 'live' })
    }

    // Try to resolve seller name
    let sellerName: string | null = null
    if (best.SellerId) {
      const profile = await prisma.sellerProfile.findUnique({ where: { sellerId: best.SellerId } })
      sellerName = profile?.name ?? null
    }

    return NextResponse.json({
      asin,
      buyBoxPrice: best.LandedPrice?.Amount ?? best.ListingPrice?.Amount ?? null,
      listingPrice: best.ListingPrice?.Amount ?? null,
      sellerName,
      sellerId: best.SellerId ?? null,
      isFba: best.IsFulfilledByAmazon ?? false,
      source: 'live',
    })
  } catch (err) {
    console.error('[buybox] ASIN=%s error=%s', asin, err instanceof Error ? err.message : String(err))
    return NextResponse.json({ asin, buyBoxPrice: null, sellerName: null, source: 'error' })
  }
}
