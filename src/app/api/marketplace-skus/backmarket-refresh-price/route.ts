/**
 * POST /api/marketplace-skus/backmarket-refresh-price
 * Body: { sellerSku: string }
 *
 * Live per-SKU price + status pull from Back Market. Read-only w.r.t. Back Market,
 * mirrors the result into MarketplaceListing. Mirrors the Amazon refresh-price flow.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from '@/lib/backmarket/client'

const bodySchema = z.object({ sellerSku: z.string().min(1) })

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { sellerSku } = parsed.data

    const listing = await prisma.marketplaceListing.findFirst({
      where: { marketplace: 'backmarket', sellerSku, accountId: null },
    })
    if (!listing) return NextResponse.json({ error: 'Back Market listing not found' }, { status: 404 })

    const cred = await prisma.backMarketCredential.findFirst({ where: { isActive: true } })
    if (!cred) return NextResponse.json({ error: 'No active Back Market credential found' }, { status: 400 })
    const client = new BackMarketClient(decrypt(cred.apiKeyEnc))

    // Prefer a single-listing GET (fast); fall back to scanning all listings by SKU
    // if the listing id is missing or the by-id endpoint isn't available.
    let live: { price?: number | string; quantity?: number | string } | null = null
    if (listing.bmListingRef != null) {
      try { live = await client.getListing(listing.bmListingRef) } catch { live = null }
    }
    if (!live || live.price == null) {
      const all = await client.fetchAllPages<{ sku?: string; price?: number | string; quantity?: number | string }>('/listings')
      live = all.find(x => x.sku && String(x.sku).toUpperCase() === sellerSku.toUpperCase()) ?? null
    }
    if (!live) return NextResponse.json({ error: 'Listing not found on Back Market' }, { status: 404 })

    const qty = live.quantity != null ? Number(live.quantity) : NaN
    const priceNum = live.price != null ? Number(live.price) : NaN
    const price = Number.isFinite(priceNum) ? priceNum : null
    const listingStatus = Number.isFinite(qty) ? (qty > 0 ? 'Active' : 'Inactive') : listing.listingStatus

    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: {
        ...(price != null ? { price } : {}),
        ...(listingStatus != null ? { listingStatus } : {}),
        lastSyncedAt: new Date(),
      },
    })

    return NextResponse.json({ sellerSku, price, listingStatus })
  } catch (err) {
    console.error('[backmarket-refresh-price]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to refresh price' }, { status: 500 })
  }
}
