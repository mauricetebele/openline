/**
 * GET /api/listings/debug?sku=IPHONE-13PROMAX-128-BLUE-UNLK-B
 *
 * Debug endpoint: fetches a listing directly from Amazon SP-API
 * to see its real status, productType, quantity, and any issues.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const sku = req.nextUrl.searchParams.get('sku')
  if (!sku) return NextResponse.json({ error: 'Missing sku param' }, { status: 400 })

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return NextResponse.json({ error: 'No active Amazon account' }, { status: 404 })

  const client = new SpApiClient(account.id)
  const encodedSku = encodeURIComponent(sku)

  try {
    // GET with all available data
    const listing = await client.get<Record<string, unknown>>(
      `/listings/2021-08-01/items/${account.sellerId}/${encodedSku}`,
      { marketplaceIds: account.marketplaceId, includedData: 'summaries,attributes,issues,offers' },
    )

    // Also check our DB state
    const dbListing = await prisma.sellerListing.findFirst({
      where: { sku, accountId: account.id },
    })

    const msku = await prisma.productGradeMarketplaceSku.findFirst({
      where: { sellerSku: sku, marketplace: 'amazon' },
      select: { sellerSku: true, lastPushedQty: true, lastPushedAt: true, syncQty: true },
    })

    // Check recent inventory feeds
    let recentFeeds = null
    try {
      recentFeeds = await client.get<Record<string, unknown>>(
        '/feeds/2021-06-30/feeds',
        { feedTypes: 'POST_INVENTORY_AVAILABILITY_DATA', pageSize: '5' },
      )
    } catch { /* non-fatal */ }

    return NextResponse.json({
      sku,
      sellerId: account.sellerId,
      amazonListing: listing,
      dbListing: dbListing ? {
        listingStatus: dbListing.listingStatus,
        quantity: dbListing.quantity,
        price: dbListing.price,
        fulfillmentChannel: dbListing.fulfillmentChannel,
        lastSyncedAt: dbListing.lastSyncedAt,
      } : null,
      msku,
      recentFeeds,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ sku, error: msg }, { status: 502 })
  }
}
