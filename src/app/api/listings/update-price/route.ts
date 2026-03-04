/**
 * POST /api/listings/update-price
 * Body: { accountId: string, sku: string, price: number }
 *
 * Updates the listed price for a single SKU on Amazon via the Listings Items API
 * and mirrors the change in the local database.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { updateListingPrice } from '@/lib/amazon/listings'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

const bodySchema = z.object({
  accountId: z.string().min(1),
  sku: z.string().min(1),
  price: z.number().positive(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const adminErr = requireAdmin(user)
    if (adminErr) return adminErr

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

    const { accountId, sku, price } = parsed.data

    // Load listing from DB to check min/max bounds
    const listing = await prisma.sellerListing.findFirst({
      where: { accountId, sku },
      select: { minPrice: true, maxPrice: true },
    })

    if (!listing) {
      return NextResponse.json({ error: `Listing not found for SKU ${sku}` }, { status: 404 })
    }

    if (listing.minPrice !== null && price < Number(listing.minPrice)) {
      return NextResponse.json(
        { error: `Price $${price.toFixed(2)} is below the minimum allowed price of $${Number(listing.minPrice).toFixed(2)}` },
        { status: 400 },
      )
    }

    if (listing.maxPrice !== null && price > Number(listing.maxPrice)) {
      return NextResponse.json(
        { error: `Price $${price.toFixed(2)} is above the maximum allowed price of $${Number(listing.maxPrice).toFixed(2)}` },
        { status: 400 },
      )
    }

    await updateListingPrice(accountId, sku, price)

    return NextResponse.json({ success: true, sku, price })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/listings/update-price]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
