/**
 * OLI Sync — fetches listing data + buy box data from Amazon SP-API
 * for all SKUs assigned to OLI pricing strategies.
 *
 * This is OLI's own sync — does NOT rely on the existing catalog sync
 * or CompetitiveOffer table. Data is cached in the `oli_sku_cache` table.
 *
 * Split into two independent phases so the UI can show Phase 1 results
 * immediately while Phase 2 continues in the background:
 *   Phase 1: Listings Items API  — status, ASIN, price, qty  (5 req/s)
 *   Phase 2: Pricing Offers API  — buy box price + winner     (0.5 req/s)
 */
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'

const LISTING_DELAY_MS = 250   // 5 req/s with margin
const BUYBOX_DELAY_MS = 2_100  // 0.5 req/s

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── SP-API response types ─────────────────────────────────────────────────

interface ListingSummary {
  marketplaceId?: string
  asin?: string
  status?: string[]
  itemName?: string
}

interface ListingOffer {
  marketplaceId?: string
  offerType?: string
  price?: { Amount?: number; CurrencyCode?: string }
}

interface ListingFulfillment {
  fulfillment_channel_code?: string
  quantity?: number
}

interface ListingPurchasableOffer {
  our_price?: Array<{
    schedule?: Array<{ value_with_tax?: number }>
  }>
}

interface ListingItemResponse {
  sku?: string
  summaries?: ListingSummary[]
  offers?: ListingOffer[]
  attributes?: {
    fulfillment_availability?: ListingFulfillment[]
    purchasable_offer?: ListingPurchasableOffer[]
  }
}

interface BuyBoxOffer {
  SellerId?: string
  IsBuyBoxWinner?: boolean
  ListingPrice?: { Amount?: number }
  LandedPrice?: { Amount?: number }
}

interface BuyBoxResponse {
  payload?: {
    Offers?: BuyBoxOffer[]
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getAmazonSkus(): Promise<string[]> {
  const assignments = await prisma.pricingStrategyMsku.findMany({
    include: { msku: { select: { sellerSku: true, marketplace: true } } },
    distinct: ['mskuId'],
  })

  return [...new Set(
    assignments
      .filter((a) => a.msku.marketplace === 'amazon')
      .map((a) => a.msku.sellerSku),
  )]
}

// ─── Phase 1: Listings (status, ASIN, price, qty) ──────────────────────────

export async function syncOliListings(): Promise<{
  synced: number
  errors: number
}> {
  const amazonSkus = await getAmazonSkus()
  if (amazonSkus.length === 0) return { synced: 0, errors: 0 }

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return { synced: 0, errors: 0 }

  const client = new SpApiClient(account.id)
  let errors = 0
  let synced = 0
  const now = new Date()

  console.log(`[OLI Sync] Phase 1 — syncing ${amazonSkus.length} listings`)

  for (let i = 0; i < amazonSkus.length; i++) {
    const sku = amazonSkus[i]

    try {
      const response = await client.get<ListingItemResponse>(
        `/listings/2021-08-01/items/${account.sellerId}/${encodeURIComponent(sku)}`,
        {
          marketplaceIds: account.marketplaceId,
          includedData: 'summaries,attributes,offers',
        },
      )

      const summary = response.summaries?.[0]
      const asin = summary?.asin ?? null
      const statusArr = summary?.status ?? []
      const listingStatus = statusArr.includes('Active') ? 'Active' : (statusArr[0] ?? null)

      // Price: try offers first, then attributes
      let price: number | null = null
      const offerPrice = response.offers?.[0]?.price?.Amount
      if (offerPrice != null) {
        price = offerPrice
      } else {
        const attrPrice = response.attributes?.purchasable_offer?.[0]?.our_price?.[0]?.schedule?.[0]?.value_with_tax
        if (attrPrice != null) price = attrPrice
      }

      // Quantity from attributes
      const qty = response.attributes?.fulfillment_availability?.[0]?.quantity ?? 0

      await prisma.oliSkuCache.upsert({
        where: { sellerSku: sku },
        create: { sellerSku: sku, asin, listingStatus, price, activeQty: qty, lastSyncedAt: now },
        update: { asin, listingStatus, price, activeQty: qty, lastSyncedAt: now },
      })

      synced++
    } catch (err) {
      errors++
      console.error(`[OLI Sync] Listing error for ${sku}:`, err instanceof Error ? err.message : String(err))
    }

    if (i < amazonSkus.length - 1) await sleep(LISTING_DELAY_MS)
  }

  console.log(`[OLI Sync] Phase 1 done — ${synced} listings, ${errors} errors`)
  return { synced, errors }
}

// ─── Phase 2: Buy Box (price + winner) ─────────────────────────────────────

export async function syncOliBuyBox(): Promise<{
  synced: number
  errors: number
}> {
  const amazonSkus = await getAmazonSkus()
  if (amazonSkus.length === 0) return { synced: 0, errors: 0 }

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return { synced: 0, errors: 0 }

  const client = new SpApiClient(account.id)

  // Build ASIN → sellerSku[] map from cache
  const cacheRows = await prisma.oliSkuCache.findMany({
    where: { sellerSku: { in: amazonSkus }, asin: { not: null } },
    select: { sellerSku: true, asin: true },
  })

  const asinToSkus = new Map<string, string[]>()
  for (const row of cacheRows) {
    if (!row.asin) continue
    const skus = asinToSkus.get(row.asin) ?? []
    skus.push(row.sellerSku)
    asinToSkus.set(row.asin, skus)
  }

  const uniqueAsins = [...asinToSkus.keys()]
  if (uniqueAsins.length === 0) return { synced: 0, errors: 0 }

  let errors = 0
  let synced = 0

  console.log(`[OLI Sync] Phase 2 — syncing ${uniqueAsins.length} buy boxes`)

  const sellerIdsToResolve = new Set<string>()
  const asinBuyBox = new Map<string, { price: number | null; sellerId: string | null }>()

  for (let i = 0; i < uniqueAsins.length; i++) {
    const asin = uniqueAsins[i]

    try {
      const response = await client.get<BuyBoxResponse>(
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
        const price = bbWinner.LandedPrice?.Amount ?? bbWinner.ListingPrice?.Amount ?? null
        const sellerId = bbWinner.SellerId ?? null
        asinBuyBox.set(asin, { price, sellerId })
        if (sellerId) sellerIdsToResolve.add(sellerId)
      } else {
        asinBuyBox.set(asin, { price: null, sellerId: null })
      }
      synced++
    } catch (err) {
      errors++
      console.error(`[OLI Sync] BuyBox error for ${asin}:`, err instanceof Error ? err.message : String(err))
    }

    if (i < uniqueAsins.length - 1) await sleep(BUYBOX_DELAY_MS)
  }

  // Resolve seller names
  const sellerNameMap = new Map<string, string>()
  if (sellerIdsToResolve.size > 0) {
    const profiles = await prisma.sellerProfile.findMany({
      where: { sellerId: { in: [...sellerIdsToResolve] } },
      select: { sellerId: true, name: true },
    })
    for (const p of profiles) {
      if (p.name) sellerNameMap.set(p.sellerId, p.name)
    }
  }

  // Write buy box data to cache
  for (const [asin, bb] of asinBuyBox) {
    const skus = asinToSkus.get(asin) ?? []
    const winnerName = bb.sellerId
      ? (sellerNameMap.get(bb.sellerId) ?? bb.sellerId)
      : null

    for (const sku of skus) {
      await prisma.oliSkuCache.update({
        where: { sellerSku: sku },
        data: { buyBoxPrice: bb.price, buyBoxWinner: winnerName },
      })
    }
  }

  console.log(`[OLI Sync] Phase 2 done — ${synced} buy boxes, ${errors} errors`)
  return { synced, errors }
}
