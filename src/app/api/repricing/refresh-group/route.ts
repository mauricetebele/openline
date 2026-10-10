/**
 * POST /api/repricing/refresh-group — per-row ↻ on the Repricing Feed.
 * Body: { accountId, asin, itemCondition }
 *
 * Live re-pull for ONE ASIN + condition, then returns that row recomputed:
 *   1. our SKUs' live price (+ the Buy Box on the first SKU) via Listings/Pricing API
 *   2. every offer on the listing — price, shipping, Prime / non-Prime, Buy Box
 *      winner, feedback (ours included)
 *   3. the Amazon title, if we don't have one yet
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { SpApiClient } from '@/lib/amazon/sp-api'
import { fetchLiveListingPrice } from '@/lib/amazon/listings'
import { pullOffersForPair, amazonItemCondition } from '@/lib/amazon/competitive-pricing'
import { fillMissingListingTitles } from '@/lib/amazon/listing-titles'
import { buildRepricingFeed } from '@/lib/repricing/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { accountId?: string; asin?: string; itemCondition?: string }
  if (!b.accountId || !b.asin || !b.itemCondition) {
    return NextResponse.json({ error: 'accountId, asin and itemCondition are required' }, { status: 400 })
  }
  const account = await prisma.amazonAccount.findUnique({ where: { id: b.accountId } })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const warnings: string[] = []
  const notes: string[] = []

  // 1. Our SKUs in this group (same set the feed uses: active, with stock) —
  //    live price; Buy Box once (it's per ASIN).
  const rows = await prisma.sellerListing.findMany({
    where: { accountId: b.accountId, asin: b.asin, listingStatus: 'Active', quantity: { gt: 0 } },
    select: { sku: true, condition: true },
  })
  const skus = rows.filter(r => amazonItemCondition(r.condition) === b.itemCondition).map(r => r.sku)
  let buyBoxPulled = false
  for (const sku of skus) {
    try {
      await fetchLiveListingPrice(b.accountId, sku, { includeBuyBox: !buyBoxPulled })
      buyBoxPulled = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/\b404\b|NOT_FOUND/.test(msg)) {
        // Amazon says this SKU doesn't exist — mirror that so it stops counting as active.
        await prisma.sellerListing.updateMany({
          where: { accountId: b.accountId, sku },
          data: { listingStatus: 'Inactive', quantity: 0 },
        })
        notes.push(`${sku} no longer exists on Amazon — marked inactive in OpenLine`)
      } else {
        warnings.push(`Price for ${sku}: ${msg}`)
      }
    }
  }

  // 2. All offers on the listing (Prime flags, Buy Box, ours included).
  let offers: number | null = null
  try {
    offers = await pullOffersForPair(new SpApiClient(account.id), account, b.asin, b.itemCondition)
    if (offers == null) warnings.push('Amazon returned no offer data for this listing')
  } catch (err) {
    warnings.push(`Offers: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 3. Title, if missing.
  await fillMissingListingTitles(b.accountId, { asin: b.asin, budgetMs: 10_000 }).catch(() => null)

  const [group] = await buildRepricingFeed({ accountId: b.accountId, asin: b.asin, itemCondition: b.itemCondition })
  return NextResponse.json({ group: group ?? null, offers, warnings, notes })
}
