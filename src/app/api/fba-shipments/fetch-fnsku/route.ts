/**
 * GET /api/fba-shipments/fetch-fnsku?accountId=...&sellerSku=...
 * Resolves FNSKU for a seller SKU via the 3-tier cascade.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { fetchFnsku } from '@/lib/amazon/fba-inbound'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = req.nextUrl.searchParams.get('accountId')
  const sellerSku = req.nextUrl.searchParams.get('sellerSku')
  if (!accountId || !sellerSku) {
    return NextResponse.json({ error: 'accountId and sellerSku are required' }, { status: 400 })
  }

  const account = await prisma.amazonAccount.findUnique({ where: { id: accountId } })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  // Tier 1: check MSKU
  const msku = await prisma.productGradeMarketplaceSku.findFirst({
    where: { sellerSku, marketplace: 'amazon', fnsku: { not: null } },
  })
  if (msku?.fnsku) {
    return NextResponse.json({ fnsku: msku.fnsku, source: 'msku' })
  }

  // Tier 2: check SellerListing
  const listing = await prisma.sellerListing.findFirst({
    where: { accountId, sku: sellerSku, fnsku: { not: null } },
  })
  if (listing?.fnsku) {
    return NextResponse.json({ fnsku: listing.fnsku, asin: listing.asin, source: 'listing' })
  }

  // Tier 3: live API
  try {
    const result = await fetchFnsku(accountId, account.marketplaceId, sellerSku)
    // Cache back to MSKU if one exists
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { sellerSku, marketplace: 'amazon', fnsku: null },
      data: { fnsku: result.fnsku },
    })
    return NextResponse.json({ ...result, source: 'api' })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'FNSKU lookup failed' },
      { status: 404 },
    )
  }
}
