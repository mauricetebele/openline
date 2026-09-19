/**
 * POST /api/listings/refresh-price
 * Body: { sku: string, accountId?: string }
 *
 * Live per-SKU price pull from Amazon (Listings Items API). Returns the current
 * price + ASIN and mirrors them into SellerListing (upserting the row if the SKU
 * was never captured by a full sync). Read-only w.r.t. Amazon (a GET),
 * so any authenticated user may trigger it. If accountId is omitted, the active
 * Amazon account is used.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { fetchLiveListingPrice } from '@/lib/amazon/listings'
import { getAuthUser } from '@/lib/get-auth-user'

const bodySchema = z.object({
  sku: z.string().min(1),
  accountId: z.string().min(1).optional(),
  // Single-row refresh pulls Buy Box too; the bulk "refresh all prices" pass
  // sends buyBox:false to stay within the rate-limited pricing endpoint.
  buyBox: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
    }

    const { sku } = parsed.data
    let accountId = parsed.data.accountId
    if (!accountId) {
      const active = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
      if (!active) return NextResponse.json({ error: 'No active Amazon account found' }, { status: 400 })
      accountId = active.id
    }

    const includeBuyBox = parsed.data.buyBox !== false
    const { asin, price, listingStatus, condition, buyBoxPrice, buyBoxSeller } =
      await fetchLiveListingPrice(accountId, sku, { includeBuyBox })
    return NextResponse.json({ sku, asin, price, listingStatus, condition, buyBoxPrice, buyBoxSeller })
  } catch (err) {
    console.error('[refresh-price]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to refresh price' },
      { status: 500 },
    )
  }
}
