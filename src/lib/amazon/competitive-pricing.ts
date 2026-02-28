/**
 * Competitive Pricing sync — fetches active competitor offers for unique ASINs
 * in the account's catalog using the SP-API Product Pricing v0 API.
 *
 * Endpoint: GET /products/pricing/v0/items/{Asin}/offers
 * Rate limit: 0.5 req/s  →  2.1 s between calls
 *
 * Requires the "Product Pricing" (Pricing) role on the SP-API application.
 * If the seller account gets a 403, add the Pricing role in Seller Central
 * Developer Console and re-authorize the account.
 *
 * Smart-cache: ASINs refreshed within the last 6 hours are skipped so that
 * subsequent syncs finish quickly. On the very first run all unique ASINs are
 * fetched (capped at MAX_PER_RUN to keep background time bounded).
 *
 * Called automatically after each catalog sync (fire-and-forget via listings.ts).
 */
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'
import { resolveSellerNames } from './seller-name'

const DELAY_MS = 2_100          // 0.5 req/s rate limit
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000  // 6 hours
const MAX_PER_RUN = 2_000       // cap per sync; active listings are already a small subset

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── SP-API v0 response types ─────────────────────────────────────────────────

interface MoneyType {
  Amount?: number
  CurrencyCode?: string
}

interface PrimeInfo {
  IsPrime?: boolean
  IsNationalPrime?: boolean
}

interface FeedbackRating {
  SellerPositiveFeedbackRating?: number
  FeedbackCount?: number
}

interface OfferV0 {
  SellerId?: string
  MyOffer?: boolean
  IsFulfilledByAmazon?: boolean
  ListingPrice?: MoneyType
  Shipping?: MoneyType
  LandedPrice?: MoneyType
  PrimeInformation?: PrimeInfo
  IsBuyBoxWinner?: boolean
  SubCondition?: string
  SellerFeedbackRating?: FeedbackRating
}

interface GetItemOffersResponse {
  payload?: {
    ASIN?: string
    status?: string
    Offers?: OfferV0[]
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function syncCompetitivePricing(accountId: string): Promise<void> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)

  // Only active listings — inactive/incomplete listings don't need competitive data
  const asinRows = await prisma.sellerListing.findMany({
    where: { accountId, asin: { not: null }, listingStatus: 'Active' },
    select: { asin: true },
    distinct: ['asin'],
  })
  const allAsins = asinRows.map((r) => r.asin!).filter(Boolean)
  if (allAsins.length === 0) {
    console.log(`[CompetitivePricing] No ASINs for account ${accountId} — skipping`)
    return
  }

  // Skip ASINs already fetched within the cache TTL window
  const cacheFloor = new Date(Date.now() - CACHE_TTL_MS)
  const recentRows = await prisma.competitiveOffer.findMany({
    where: { accountId, lastFetchedAt: { gte: cacheFloor } },
    select: { asin: true },
    distinct: ['asin'],
  })
  const freshAsins = new Set(recentRows.map((r) => r.asin))
  const staleAsins = allAsins.filter((a) => !freshAsins.has(a))

  if (staleAsins.length === 0) {
    console.log(`[CompetitivePricing] All ${allAsins.length} ASINs are fresh — skipping`)
    return
  }

  // Cap per run to keep background processing bounded
  const asinsToFetch = staleAsins.slice(0, MAX_PER_RUN)
  console.log(
    `[CompetitivePricing] Fetching ${asinsToFetch.length} of ${staleAsins.length} stale ASINs` +
    ` (${freshAsins.size} cached, cap ${MAX_PER_RUN})`,
  )

  let fetched = 0
  let errors = 0

  for (let i = 0; i < asinsToFetch.length; i++) {
    const asin = asinsToFetch[i]

    try {
      const response = await client.get<GetItemOffersResponse>(
        `/products/pricing/v0/items/${asin}/offers`,
        {
          MarketplaceId: account.marketplaceId,
          ItemCondition: 'New',
          CustomerType: 'Consumer',
        },
      )

      const payload = response?.payload
      if (!payload || payload.status === 'Failed') continue

      const offers = payload.Offers ?? []

      // Replace stale data atomically
      await prisma.competitiveOffer.deleteMany({ where: { accountId, asin } })

      if (offers.length > 0) {
        await prisma.competitiveOffer.createMany({
          skipDuplicates: true,
          data: offers.map((o) => {
            const listingPrice = o.ListingPrice?.Amount ?? 0
            const shippingPrice = o.Shipping?.Amount ?? 0
            const landedPrice = o.LandedPrice?.Amount ?? listingPrice + shippingPrice

            const sid = o.SellerId ?? 'unknown'
            return {
              accountId,
              asin,
              sellerId: sid,
              // MyOffer from the API is unreliable — match by seller ID directly
              isMyOffer: o.MyOffer === true || sid === account.sellerId,
              fulfillmentType: o.IsFulfilledByAmazon ? 'FBA' : 'MFN',
              listingPrice,
              shippingPrice,
              landedPrice,
              isPrime: o.PrimeInformation?.IsPrime ?? false,
              isBuyBoxWinner: o.IsBuyBoxWinner ?? false,
              condition: o.SubCondition ?? 'new',
              feedbackRating: o.SellerFeedbackRating?.SellerPositiveFeedbackRating ?? null,
              feedbackCount: o.SellerFeedbackRating?.FeedbackCount ?? null,
              lastFetchedAt: new Date(),
            }
          }),
        })

        // Resolve seller names for any IDs not yet cached — fire-and-forget
        const sellerIds = offers
          .map((o) => o.SellerId)
          .filter((id): id is string => Boolean(id) && id !== 'unknown')
        if (sellerIds.length > 0) {
          resolveSellerNames(sellerIds, account.marketplaceId).catch((err) => {
            console.error('[CompetitivePricing] seller name resolution error:', err instanceof Error ? err.message : err)
          })
        }
      }

      fetched++
    } catch (err: unknown) {
      errors++
      const msg = err instanceof Error ? err.message : String(err)
      // Log first error and every 50th to avoid flooding logs
      if (errors === 1 || errors % 50 === 0) {
        console.error(`[CompetitivePricing] Error on ASIN ${asin} (error #${errors}): ${msg}`)
      }
      // If the very first call is a 403, the whole run will fail — abort early
      if (errors === 1 && msg.includes('403')) {
        console.error(
          '[CompetitivePricing] 403 on first call — aborting. ' +
          'The SP-API application is missing the "Product Pricing" role. ' +
          'Add it in Seller Central → Apps & Services → Develop Apps, then re-authorize.',
        )
        return
      }
    }

    if (i < asinsToFetch.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  console.log(
    `[CompetitivePricing] Done — ${fetched} ASINs updated, ${errors} errors` +
    (staleAsins.length > MAX_PER_RUN
      ? ` (${staleAsins.length - MAX_PER_RUN} remaining stale ASINs will be fetched on next sync)`
      : ''),
  )
}
