/**
 * POST /api/marketplace-skus/sync  — sync listings from a marketplace into MarketplaceListing
 * GET  /api/marketplace-skus/sync  — list all synced marketplace listings with mapping info
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from '@/lib/backmarket/client'

export const dynamic = 'force-dynamic'

// ─── GET: list all synced marketplace listings ──────────────────────────────

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const marketplace = req.nextUrl.searchParams.get('marketplace')?.toLowerCase()

    const listings = await prisma.marketplaceListing.findMany({
      where: marketplace ? { marketplace } : undefined,
      include: {
        msku: {
          include: {
            product: { select: { id: true, sku: true, description: true } },
            grade: { select: { id: true, grade: true } },
          },
        },
      },
      orderBy: [{ marketplace: 'asc' }, { sellerSku: 'asc' }],
    })

    return NextResponse.json({ data: listings })
  } catch (err) {
    console.error('[marketplace-skus/sync GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load listings' },
      { status: 500 },
    )
  }
}

// ─── POST: sync listings from a marketplace ─────────────────────────────────

interface BackMarketListing {
  sku: string
  title?: string
  product?: string
  listing_id?: number
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { marketplace } = body as { marketplace: string }

  if (!marketplace) {
    return NextResponse.json({ error: 'marketplace is required' }, { status: 400 })
  }

  const mp = marketplace.toLowerCase()
  if (mp !== 'amazon' && mp !== 'backmarket') {
    return NextResponse.json(
      { error: 'marketplace must be "amazon" or "backmarket"' },
      { status: 400 },
    )
  }

  if (mp === 'amazon') {
    return syncAmazon()
  } else {
    return syncBackMarket()
  }
}

// ─── Amazon sync ─────────────────────────────────────────────────────────────

// Amazon ASINs used as SKUs — skip these (not real seller-managed listings)
const ASIN_AS_SKU_RE = /^B0[A-Z0-9]{8}$/

async function syncAmazon() {
  // If no seller listings exist, the user needs to sync the catalog first
  const count = await prisma.sellerListing.count()
  if (count === 0) {
    return NextResponse.json(
      { error: 'No Amazon catalog data found. Go to Active Listings and click "Sync Catalog" first, then try again.' },
      { status: 400 },
    )
  }

  const listings = await prisma.sellerListing.findMany({
    select: {
      sku: true,
      productTitle: true,
      accountId: true,
      fulfillmentChannel: true,
    },
  })

  // Filter out entries where Amazon used the ASIN as the SKU
  const filtered = listings.filter(l => !ASIN_AS_SKU_RE.test(l.sku))

  let newCount = 0

  for (const listing of filtered) {
    const existing = await prisma.marketplaceListing.findFirst({
      where: {
        marketplace: 'amazon',
        sellerSku: listing.sku,
        accountId: listing.accountId,
      },
    })

    if (existing) {
      await prisma.marketplaceListing.update({
        where: { id: existing.id },
        data: {
          title: listing.productTitle,
          fulfillmentChannel: listing.fulfillmentChannel,
          lastSyncedAt: new Date(),
        },
      })
    } else {
      await prisma.marketplaceListing.create({
        data: {
          marketplace: 'amazon',
          sellerSku: listing.sku,
          accountId: listing.accountId,
          title: listing.productTitle,
          fulfillmentChannel: listing.fulfillmentChannel,
        },
      })
      newCount++
    }
  }

  return NextResponse.json({ synced: filtered.length, new: newCount })
}

// ─── Back Market sync ────────────────────────────────────────────────────────

async function syncBackMarket() {
  const cred = await prisma.backMarketCredential.findFirst({
    where: { isActive: true },
  })

  if (!cred) {
    return NextResponse.json(
      { error: 'No active Back Market credential found' },
      { status: 400 },
    )
  }

  const apiKey = decrypt(cred.apiKeyEnc)
  const client = new BackMarketClient(apiKey)
  const bmListings = await client.fetchAllPages<BackMarketListing>('/listings')

  let newCount = 0

  for (const bm of bmListings) {
    const sku = bm.sku
    if (!sku) continue

    const existing = await prisma.marketplaceListing.findFirst({
      where: {
        marketplace: 'backmarket',
        sellerSku: sku,
        accountId: null,
      },
    })

    if (existing) {
      await prisma.marketplaceListing.update({
        where: { id: existing.id },
        data: {
          title: bm.title || bm.product || null,
          lastSyncedAt: new Date(),
        },
      })
    } else {
      await prisma.marketplaceListing.create({
        data: {
          marketplace: 'backmarket',
          sellerSku: sku,
          accountId: null,
          title: bm.title || bm.product || null,
        },
      })
      newCount++
    }
  }

  return NextResponse.json({ synced: bmListings.length, new: newCount })
}
