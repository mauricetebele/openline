/**
 * GET /api/oli/strategies/[id]/buybox
 *
 * Fetches live Buy Box data from SP-API for all ASINs in a strategy.
 * Called asynchronously by the frontend after the main strategy detail loads.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { fetchBuyBoxLive } from '@/lib/oli/fetch-buybox'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const strategy = await prisma.pricingStrategy.findUnique({
    where: { id: params.id },
    include: {
      mskuAssignments: {
        include: {
          msku: { select: { sellerSku: true } },
        },
      },
    },
  })

  if (!strategy) {
    return NextResponse.json({ error: 'Strategy not found' }, { status: 404 })
  }

  const sellerSkus = strategy.mskuAssignments.map((a) => a.msku.sellerSku)

  // Get ASIN + accountId from SellerListing
  const listings = sellerSkus.length > 0
    ? await prisma.sellerListing.findMany({
        where: { sku: { in: sellerSkus }, asin: { not: null } },
        select: { sku: true, asin: true, accountId: true },
        distinct: ['sku'],
      })
    : []

  // Group ASINs by account
  const asinsByAccount = new Map<string, string[]>()
  const skuToAsin = new Map<string, string>()
  const asinToSkus = new Map<string, string[]>()

  for (const l of listings) {
    if (!l.asin) continue
    skuToAsin.set(l.sku, l.asin)

    const existing = asinsByAccount.get(l.accountId) ?? []
    if (!existing.includes(l.asin)) existing.push(l.asin)
    asinsByAccount.set(l.accountId, existing)

    const skus = asinToSkus.get(l.asin) ?? []
    skus.push(l.sku)
    asinToSkus.set(l.asin, skus)
  }

  // Fetch live buy box data
  const buyBoxBySku: Record<string, { buyBoxPrice: number | null; buyBoxWinner: string | null }> = {}

  for (const [accountId, asins] of asinsByAccount) {
    const results = await fetchBuyBoxLive(accountId, asins)
    for (const [asin, bb] of results) {
      const skus = asinToSkus.get(asin) ?? []
      for (const sku of skus) {
        buyBoxBySku[sku] = {
          buyBoxPrice: bb.price,
          buyBoxWinner: bb.sellerName,
        }
      }
    }
  }

  return NextResponse.json(buyBoxBySku)
}
