/**
 * OLI — Live Buy Box fetcher
 *
 * Fetches Buy Box data directly from Amazon SP-API for a batch of ASINs.
 * This is OLI's own implementation — does NOT rely on the cached
 * CompetitiveOffer table or the background competitive pricing sync.
 *
 * Endpoint: GET /products/pricing/v0/items/{ASIN}/offers
 * Rate limit: 0.5 req/s → 2.1 s delay between calls
 */
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'

const DELAY_MS = 2_100

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export interface BuyBoxResult {
  price: number | null
  sellerName: string | null
  sellerId: string | null
}

interface OfferResponse {
  payload?: {
    ASIN?: string
    status?: string
    Offers?: Array<{
      SellerId?: string
      IsBuyBoxWinner?: boolean
      ListingPrice?: { Amount?: number }
      LandedPrice?: { Amount?: number }
      IsFulfilledByAmazon?: boolean
    }>
  }
}

/**
 * Live-fetches Buy Box data for a batch of ASINs from SP-API.
 * Returns a Map<asin, BuyBoxResult>.
 */
export async function fetchBuyBoxLive(
  accountId: string,
  asins: string[],
): Promise<Map<string, BuyBoxResult>> {
  const results = new Map<string, BuyBoxResult>()
  if (asins.length === 0) return results

  const account = await prisma.amazonAccount.findUnique({
    where: { id: accountId },
    select: { marketplaceId: true },
  })
  if (!account) return results

  const client = new SpApiClient(accountId)
  const uniqueAsins = [...new Set(asins)]

  // Collect seller IDs for batch name resolution after all fetches
  const sellerIdsToResolve = new Set<string>()
  const asinSellerMap = new Map<string, string>()

  for (let i = 0; i < uniqueAsins.length; i++) {
    const asin = uniqueAsins[i]

    try {
      const response = await client.get<OfferResponse>(
        `/products/pricing/v0/items/${asin}/offers`,
        {
          MarketplaceId: account.marketplaceId,
          ItemCondition: 'New',
          CustomerType: 'Consumer',
        },
      )

      const offers = response?.payload?.Offers ?? []
      const bbWinner = offers.find((o) => o.IsBuyBoxWinner)

      if (bbWinner) {
        const price = bbWinner.LandedPrice?.Amount
          ?? bbWinner.ListingPrice?.Amount
          ?? null
        const sellerId = bbWinner.SellerId ?? null

        results.set(asin, { price, sellerName: null, sellerId })

        if (sellerId) {
          sellerIdsToResolve.add(sellerId)
          asinSellerMap.set(asin, sellerId)
        }
      } else {
        results.set(asin, { price: null, sellerName: null, sellerId: null })
      }
    } catch (err) {
      console.error(
        `[OLI BuyBox] Error fetching ASIN ${asin}:`,
        err instanceof Error ? err.message : String(err),
      )
      results.set(asin, { price: null, sellerName: null, sellerId: null })
    }

    // Rate limit between calls
    if (i < uniqueAsins.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  // Batch-resolve seller names from SellerProfile cache
  if (sellerIdsToResolve.size > 0) {
    const profiles = await prisma.sellerProfile.findMany({
      where: { sellerId: { in: [...sellerIdsToResolve] } },
      select: { sellerId: true, name: true },
    })
    const nameMap = new Map(profiles.map((p) => [p.sellerId, p.name]))

    for (const [asin, sellerId] of asinSellerMap) {
      const existing = results.get(asin)
      if (existing) {
        existing.sellerName = nameMap.get(sellerId) ?? sellerId
      }
    }
  }

  return results
}
