/**
 * Competitive Pricing sync — fetches competitor offers per ASIN + Amazon
 * ItemCondition (New / Used / …) for the account's active listings, using the
 * SP-API Product Pricing v0 API. Feeds the repricing suggestion feed.
 *
 * Endpoint: GET /products/pricing/v0/items/{Asin}/offers?ItemCondition=…
 * Rate limit: 0.5 req/s  →  2.1 s between calls
 *
 * Requires the "Product Pricing" (Pricing) role on the SP-API application.
 * If the seller account gets a 403, add the Pricing role in Seller Central
 * Developer Console and re-authorize the account.
 *
 * Smart-cache: pairs refreshed within CACHE_TTL are skipped; the stalest pairs go
 * first, and a run stops starting new calls once `budgetMs` is spent, so the
 * hourly cron keeps everything at most ~a day old.
 *
 * Called by /api/cron/sync-competitive-offers and after each catalog sync.
 */
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'
import { resolveSellerNames } from './seller-name'

const DELAY_MS = 2_100          // 0.5 req/s rate limit
const CACHE_TTL_MS = 20 * 60 * 60 * 1_000  // 20 hours — refreshed ~daily by the hourly cron

/** Map a listing condition ("New", "Used - Good", "Renewed") to Amazon's ItemCondition. */
export function amazonItemCondition(listingCondition: string | null | undefined): 'New' | 'Used' | 'Refurbished' | 'Collectible' {
  const c = (listingCondition ?? '').toLowerCase()
  if (c.startsWith('used')) return 'Used'
  if (c.startsWith('refurb') || c.startsWith('renewed')) return 'Refurbished'
  if (c.startsWith('collect')) return 'Collectible'
  return 'New'
}

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

export interface CompetitivePricingResult { pairs: number; fetched: number; errors: number; remainingStale: number }

export async function syncCompetitivePricing(
  accountId: string,
  opts: { budgetMs?: number; maxAgeMs?: number } = {}, // maxAgeMs: re-pull pairs older than this (default 20 h)
): Promise<CompetitivePricingResult> {
  const started = Date.now()
  const budgetMs = opts.budgetMs ?? Infinity
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)

  // Active MFN-or-FBA listings → unique ASIN + Amazon ItemCondition pairs
  const listingRows = await prisma.sellerListing.findMany({
    where: { accountId, asin: { not: null }, listingStatus: 'Active' },
    select: { asin: true, condition: true },
  })
  const pairKey = (asin: string, cond: string) => `${asin}|${cond}`
  const pairs = new Map<string, { asin: string; itemCondition: string }>()
  for (const r of listingRows) {
    const itemCondition = amazonItemCondition(r.condition)
    pairs.set(pairKey(r.asin!, itemCondition), { asin: r.asin!, itemCondition })
  }
  if (pairs.size === 0) {
    console.log(`[CompetitivePricing] No ASINs for account ${accountId} — skipping`)
    return { pairs: 0, fetched: 0, errors: 0, remainingStale: 0 }
  }

  // Last fetch per pair → skip fresh ones, do the stalest first
  const lastRows = await prisma.competitiveOffer.groupBy({
    by: ['asin', 'itemCondition'],
    where: { accountId },
    _max: { lastFetchedAt: true },
  })
  const lastFetched = new Map(lastRows.map(r => [pairKey(r.asin, r.itemCondition), r._max.lastFetchedAt?.getTime() ?? 0]))
  const cacheFloor = Date.now() - (opts.maxAgeMs ?? CACHE_TTL_MS)
  const stale = Array.from(pairs.entries())
    .map(([k, p]) => ({ ...p, last: lastFetched.get(k) ?? 0 }))
    .filter(p => p.last < cacheFloor)
    .sort((a, b) => a.last - b.last)

  if (stale.length === 0) {
    console.log(`[CompetitivePricing] All ${pairs.size} ASIN+condition pairs are fresh — skipping`)
    return { pairs: pairs.size, fetched: 0, errors: 0, remainingStale: 0 }
  }
  console.log(`[CompetitivePricing] ${stale.length} of ${pairs.size} ASIN+condition pairs stale`)

  let fetched = 0
  let errors = 0

  for (let i = 0; i < stale.length; i++) {
    if (Date.now() - started > budgetMs) break
    const { asin, itemCondition } = stale[i]

    try {
      const response = await client.get<GetItemOffersResponse>(
        `/products/pricing/v0/items/${asin}/offers`,
        {
          MarketplaceId: account.marketplaceId,
          ItemCondition: itemCondition,
          CustomerType: 'Consumer',
        },
      )

      const payload = response?.payload
      if (!payload || payload.status === 'Failed') continue

      const offers = payload.Offers ?? []

      // Replace this pair's stale data
      await prisma.competitiveOffer.deleteMany({ where: { accountId, asin, itemCondition } })

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
              itemCondition,
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
        console.error(`[CompetitivePricing] Error on ${asin} ${itemCondition} (error #${errors}): ${msg}`)
      }
      // If the very first call is a 403, the whole run will fail — abort early
      if (errors === 1 && msg.includes('403')) {
        console.error(
          '[CompetitivePricing] 403 on first call — aborting. ' +
          'The SP-API application is missing the "Product Pricing" role. ' +
          'Add it in Seller Central → Apps & Services → Develop Apps, then re-authorize.',
        )
        return { pairs: pairs.size, fetched, errors, remainingStale: stale.length - fetched }
      }
    }

    if (i < stale.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  const remainingStale = stale.length - fetched - errors
  console.log(`[CompetitivePricing] Done — ${fetched} pairs updated, ${errors} errors, ${remainingStale} still stale (next run)`)
  return { pairs: pairs.size, fetched, errors, remainingStale }
}
