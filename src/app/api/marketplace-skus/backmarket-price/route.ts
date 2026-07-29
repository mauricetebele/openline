/**
 * POST /api/marketplace-skus/backmarket-price
 * Body: { sellerSku: string, price: number }
 *
 * Updates the price for a Back Market listing (by its stored listing_id) and mirrors
 * it into MarketplaceListing.price.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { BackMarketClient } from '@/lib/backmarket/client'
import { decrypt } from '@/lib/crypto'

const bodySchema = z.object({
  sellerSku: z.string().min(1),
  price: z.number().positive(),
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
    const { sellerSku, price } = parsed.data

    const listing = await prisma.marketplaceListing.findFirst({
      where: { marketplace: 'backmarket', sellerSku },
      select: { id: true, bmListingRef: true },
    })
    if (!listing) {
      return NextResponse.json({ error: `No Back Market listing found for SKU "${sellerSku}"` }, { status: 404 })
    }
    if (listing.bmListingRef == null) {
      return NextResponse.json(
        { error: 'No Back Market listing id on file for this SKU — run "Sync Back Market" first, then try again.' },
        { status: 400 },
      )
    }

    const cred = await prisma.backMarketCredential.findFirst({ where: { isActive: true } })
    if (!cred) return NextResponse.json({ error: 'No active Back Market credential' }, { status: 400 })

    const client = new BackMarketClient(decrypt(cred.apiKeyEnc))
    await client.updateListingPrice(listing.bmListingRef, price)

    await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { price } })

    return NextResponse.json({ sellerSku, price })
  } catch (err) {
    console.error('[backmarket-price]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update Back Market price' },
      { status: 500 },
    )
  }
}
