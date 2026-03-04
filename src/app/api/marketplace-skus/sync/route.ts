/**
 * POST /api/marketplace-skus/sync  — sync listings from a marketplace into MarketplaceListing
 * GET  /api/marketplace-skus/sync  — list all synced marketplace listings with mapping info
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from '@/lib/backmarket/client'
import { waitUntil } from '@vercel/functions'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ─── GET: list synced listings OR poll sync job progress ─────────────────────

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // If jobId param is present, return job progress
    const jobId = req.nextUrl.searchParams.get('jobId')
    if (jobId) {
      const job = await prisma.listingSyncJob.findUnique({ where: { id: jobId } })
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      return NextResponse.json(job)
    }

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
    // Check catalog exists
    const count = await prisma.sellerListing.count()
    if (count === 0) {
      return NextResponse.json(
        { error: 'No Amazon catalog data found. Go to Active Listings and click "Sync Catalog" first, then try again.' },
        { status: 400 },
      )
    }

    // Find account for job tracking
    const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
    if (!account) {
      return NextResponse.json({ error: 'No active Amazon account' }, { status: 400 })
    }

    const job = await prisma.listingSyncJob.create({
      data: { accountId: account.id, status: 'RUNNING' },
    })

    waitUntil(
      syncAmazon(job.id).catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[MarketplaceSync] Amazon job failed:', message)
        await prisma.listingSyncJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
        })
      })
    )

    return NextResponse.json({ jobId: job.id }, { status: 202 })
  } else {
    return syncBackMarket()
  }
}

// ─── Amazon sync ─────────────────────────────────────────────────────────────

// Amazon ASINs used as SKUs — skip these (not real seller-managed listings)
const ASIN_AS_SKU_RE = /^B0[A-Z0-9]{8}$/

async function syncAmazon(jobId: string) {
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
  const total = filtered.length

  await prisma.listingSyncJob.update({
    where: { id: jobId },
    data: { totalFound: total },
  })

  let newCount = 0
  let processed = 0

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

    processed++
    // Update progress every 100 records
    if (processed % 100 === 0 || processed === total) {
      await prisma.listingSyncJob.update({
        where: { id: jobId },
        data: { totalUpserted: processed },
      })
    }
  }

  await prisma.listingSyncJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', totalUpserted: processed, completedAt: new Date() },
  })
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
