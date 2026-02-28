/**
 * GET /api/pricing/competitors?accountId=&asin=
 *
 * Returns all competitive offers stored for a given ASIN, ordered by:
 *   1. Buy box winner first
 *   2. Landed price ascending
 *
 * Seller names are joined from the SellerProfile cache where available.
 * Amazon's SP-API does not expose competitor names — they are resolved by
 * fetching public Amazon seller profile pages and cached permanently.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = req.nextUrl
    const accountId = searchParams.get('accountId')?.trim()
    const asin = searchParams.get('asin')?.trim()

    if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })
    if (!asin) return NextResponse.json({ error: 'Missing asin' }, { status: 400 })

    // Fetch account sellerId so we can flag the user's own offer even if
    // the DB row has isMyOffer=false (e.g. synced before this fix)
    const account = await prisma.amazonAccount.findUnique({
      where: { id: accountId },
      select: { sellerId: true },
    })
    const mySellerId = account?.sellerId ?? null

    const offers = await prisma.competitiveOffer.findMany({
      where: { accountId, asin },
      orderBy: [{ isBuyBoxWinner: 'desc' }, { landedPrice: 'asc' }],
    })

    // Join seller names from the cache
    const sellerIds = [...new Set(offers.map((o) => o.sellerId))]
    const profiles = sellerIds.length > 0
      ? await prisma.sellerProfile.findMany({ where: { sellerId: { in: sellerIds } } })
      : []
    const nameBySellerid = new Map(profiles.map((p) => [p.sellerId, p.name]))

    const data = offers.map((o) => ({
      ...o,
      // Re-derive isMyOffer by seller ID so old rows are correctly flagged
      isMyOffer: o.isMyOffer || (mySellerId !== null && o.sellerId === mySellerId),
      sellerName: nameBySellerid.get(o.sellerId) ?? null,
    }))

    const lastFetchedAt = offers[0]?.lastFetchedAt ?? null

    return NextResponse.json({ asin, data, lastFetchedAt })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[GET /api/pricing/competitors]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
