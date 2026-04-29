/**
 * OLI Sync — fetches listing data + buy box data from Amazon SP-API
 * for all SKUs assigned to OLI pricing strategies.
 *
 * This is OLI's own sync — does NOT rely on the existing catalog sync
 * or CompetitiveOffer table. Data is cached in the `oli_sku_cache` table.
 *
 * Two phases with progress callbacks for streaming UI updates:
 *   Phase 1: Listings Items API        — status, ASIN, price, qty  (5 req/s)
 *   Phase 2: Competitive Pricing API   — buy box price + ownership  (batched 20/req, ~10 req/s)
 *            + Item Offers API fallback — competitor name lookup     (0.5 req/s, only non-owned)
 */
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'

const LISTING_DELAY_MS = 250      // 5 req/s with margin
const BATCH_DELAY_MS = 150        // ~10 req/s for competitive pricing batches
const COMPETITOR_DELAY_MS = 2_100 // 0.5 req/s for individual item offers fallback
const BATCH_SIZE = 20             // max ASINs per competitive pricing request

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Progress callback type ────────────────────────────────────────────────

export interface SyncProgress {
  phase: 'listings' | 'buybox'
  current: number
  total: number
  label: string  // SKU or ASIN being processed
  done?: boolean
}

export type OnProgress = (p: SyncProgress) => void

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

interface ListingIssue {
  code?: string
  message?: string
  severity?: string // ERROR, WARNING
}

interface ListingItemResponse {
  sku?: string
  summaries?: ListingSummary[]
  offers?: ListingOffer[]
  issues?: ListingIssue[]
  attributes?: {
    fulfillment_availability?: ListingFulfillment[]
    purchasable_offer?: ListingPurchasableOffer[]
  }
}

// Competitive Pricing API (batched, accurate ownership via belongsToRequester)
interface CompetitivePriceEntry {
  CompetitivePriceId?: string
  Price?: {
    LandedPrice?: { Amount?: number }
    ListingPrice?: { Amount?: number }
  }
  belongsToRequester?: boolean
  condition?: string
}

interface CompetitivePricingItem {
  ASIN: string
  status: string
  Product?: {
    CompetitivePricing?: {
      CompetitivePrices?: CompetitivePriceEntry[]
    }
  }
}

interface CompetitivePricingResponse {
  payload?: CompetitivePricingItem[]
}

// Item Offers API (fallback for competitor name lookup)
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

  return Array.from(new Set(
    assignments
      .filter((a) => a.msku.marketplace === 'amazon')
      .map((a) => a.msku.sellerSku),
  ))
}

// ─── Phase 1: Listings (status, ASIN, price, qty) ──────────────────────────

export async function syncOliListings(onProgress?: OnProgress): Promise<{
  synced: number
  errors: number
}> {
  const amazonSkus = await getAmazonSkus()
  if (amazonSkus.length === 0) {
    onProgress?.({ phase: 'listings', current: 0, total: 0, label: '', done: true })
    return { synced: 0, errors: 0 }
  }

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return { synced: 0, errors: 0 }

  const client = new SpApiClient(account.id)
  let errors = 0
  let synced = 0
  const now = new Date()
  const total = amazonSkus.length

  console.log(`[OLI Sync] Phase 1 — syncing ${total} listings`)

  for (let i = 0; i < amazonSkus.length; i++) {
    const sku = amazonSkus[i]
    onProgress?.({ phase: 'listings', current: i + 1, total, label: sku })

    try {
      const response = await client.get<ListingItemResponse>(
        `/listings/2021-08-01/items/${account.sellerId}/${encodeURIComponent(sku)}`,
        {
          marketplaceIds: account.marketplaceId,
          includedData: 'summaries,attributes,offers,issues',
        },
      )

      const summary = response.summaries?.[0]
      const asin = summary?.asin ?? null
      const title = summary?.itemName ?? null
      const statusArr = summary?.status ?? []

      // Determine listing status:
      // - BUYABLE = active and purchasable
      // - Check issues for CLOSED/BLOCKED/suppressed
      // - Fall back to raw status array
      let listingStatus: string | null
      if (statusArr.includes('BUYABLE')) {
        listingStatus = 'BUYABLE'
      } else {
        // Check for blocking issues
        const blockingIssues = (response.issues ?? []).filter((i) => i.severity === 'ERROR')
        if (blockingIssues.length > 0) {
          listingStatus = 'BLOCKED'
        } else {
          listingStatus = statusArr[0] ?? null
        }
      }

      let price: number | null = null
      const offerPrice = response.offers?.[0]?.price?.Amount
      if (offerPrice != null) {
        price = offerPrice
      } else {
        const attrPrice = response.attributes?.purchasable_offer?.[0]?.our_price?.[0]?.schedule?.[0]?.value_with_tax
        if (attrPrice != null) price = attrPrice
      }

      const qty = response.attributes?.fulfillment_availability?.[0]?.quantity ?? 0

      await prisma.oliSkuCache.upsert({
        where: { sellerSku: sku },
        create: { sellerSku: sku, asin, title, listingStatus, price, activeQty: qty, lastSyncedAt: now },
        update: { asin, title, listingStatus, price, activeQty: qty, lastSyncedAt: now },
      })

      synced++
    } catch (err) {
      errors++
      console.error(`[OLI Sync] Listing error for ${sku}:`, err instanceof Error ? err.message : String(err))
    }

    if (i < amazonSkus.length - 1) await sleep(LISTING_DELAY_MS)
  }

  onProgress?.({ phase: 'listings', current: total, total, label: '', done: true })
  console.log(`[OLI Sync] Phase 1 done — ${synced} listings, ${errors} errors`)
  return { synced, errors }
}

// ─── Phase 2: Buy Box (Competitive Pricing + competitor fallback) ────────

export async function syncOliBuyBox(onProgress?: OnProgress): Promise<{
  synced: number
  errors: number
}> {
  const amazonSkus = await getAmazonSkus()
  if (amazonSkus.length === 0) return { synced: 0, errors: 0 }

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return { synced: 0, errors: 0 }

  const client = new SpApiClient(account.id)

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

  const uniqueAsins = Array.from(asinToSkus.keys())
  if (uniqueAsins.length === 0) {
    onProgress?.({ phase: 'buybox', current: 0, total: 0, label: '', done: true })
    return { synced: 0, errors: 0 }
  }

  let errors = 0
  let synced = 0

  console.log(`[OLI Sync] Phase 2 — checking ${uniqueAsins.length} ASINs via Competitive Pricing API`)

  // ── Step 1: Batch Competitive Pricing (fast: 20/batch, ~10 req/s) ─────
  // Uses belongsToRequester for definitive buy box ownership detection
  const asinBuyBox = new Map<string, { price: number | null; isOurs: boolean; sellerId: string | null }>()
  const totalBatches = Math.ceil(uniqueAsins.length / BATCH_SIZE)

  for (let i = 0; i < uniqueAsins.length; i += BATCH_SIZE) {
    const batch = uniqueAsins.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    onProgress?.({ phase: 'buybox', current: i, total: uniqueAsins.length, label: `Batch ${batchNum}/${totalBatches}` })

    try {
      // Build URL with repeated Asins params (SP-API array format)
      const qs = new URLSearchParams()
      qs.append('MarketplaceId', account.marketplaceId)
      qs.append('ItemType', 'Asin')
      for (const asin of batch) qs.append('Asins', asin)

      const response = await client.get<CompetitivePricingResponse>(
        `/products/pricing/v0/competitivePrice?${qs.toString()}`,
      )

      for (const item of response.payload ?? []) {
        if (item.status !== 'Success') {
          asinBuyBox.set(item.ASIN, { price: null, isOurs: false, sellerId: null })
          continue
        }

        const prices = item.Product?.CompetitivePricing?.CompetitivePrices ?? []
        // CompetitivePriceId "1" = New Buy Box Price
        const bbEntry = prices.find((p) => p.CompetitivePriceId === '1')

        if (bbEntry) {
          const price = bbEntry.Price?.LandedPrice?.Amount ?? bbEntry.Price?.ListingPrice?.Amount ?? null
          asinBuyBox.set(item.ASIN, { price, isOurs: bbEntry.belongsToRequester === true, sellerId: null })
        } else {
          asinBuyBox.set(item.ASIN, { price: null, isOurs: false, sellerId: null })
        }
      }

      synced += batch.length
    } catch (err) {
      errors += batch.length
      console.error(`[OLI Sync] Competitive pricing batch error:`, err instanceof Error ? err.message : String(err))
    }

    if (i + BATCH_SIZE < uniqueAsins.length) await sleep(BATCH_DELAY_MS)
  }

  // ── Step 2: Competitor name lookup (only for non-owned buy boxes) ─────
  // Uses getItemOffers to identify WHO has the buy box when it's not us
  const competitorAsins = Array.from(asinBuyBox.entries())
    .filter(([, bb]) => !bb.isOurs && bb.price != null)
    .map(([asin]) => asin)

  const grandTotal = uniqueAsins.length + competitorAsins.length

  if (competitorAsins.length > 0) {
    console.log(`[OLI Sync] Phase 2b — identifying ${competitorAsins.length} competitor buy box holders`)

    for (let i = 0; i < competitorAsins.length; i++) {
      const asin = competitorAsins[i]
      onProgress?.({ phase: 'buybox', current: uniqueAsins.length + i + 1, total: grandTotal, label: asin })

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
        if (bbWinner?.SellerId) {
          const bb = asinBuyBox.get(asin)!
          bb.sellerId = bbWinner.SellerId
        }
      } catch (err) {
        console.error(`[OLI Sync] Competitor lookup error for ${asin}:`, err instanceof Error ? err.message : String(err))
      }

      if (i < competitorAsins.length - 1) await sleep(COMPETITOR_DELAY_MS)
    }
  }

  // ── Step 3: Resolve seller names ──────────────────────────────────────
  const sellerIdsToResolve = new Set<string>()
  Array.from(asinBuyBox.values()).forEach((bb) => {
    if (bb.sellerId && !bb.isOurs) sellerIdsToResolve.add(bb.sellerId)
  })

  const sellerNameMap = new Map<string, string>()
  if (sellerIdsToResolve.size > 0) {
    const profiles = await prisma.sellerProfile.findMany({
      where: { sellerId: { in: Array.from(sellerIdsToResolve) } },
      select: { sellerId: true, name: true },
    })
    for (const p of profiles) {
      if (p.name) sellerNameMap.set(p.sellerId, p.name)
    }
  }

  // ── Step 4: Write to cache ────────────────────────────────────────────
  for (const [asin, bb] of Array.from(asinBuyBox.entries())) {
    const skus = asinToSkus.get(asin) ?? []
    let winnerName: string | null
    if (bb.isOurs) {
      winnerName = 'You'
    } else if (bb.sellerId) {
      winnerName = sellerNameMap.get(bb.sellerId) ?? bb.sellerId
    } else {
      winnerName = null
    }

    for (const sku of skus) {
      await prisma.oliSkuCache.update({
        where: { sellerSku: sku },
        data: { buyBoxPrice: bb.price, buyBoxWinner: winnerName },
      })
    }
  }

  onProgress?.({ phase: 'buybox', current: grandTotal, total: grandTotal, label: '', done: true })
  console.log(`[OLI Sync] Phase 2 done — ${synced} ASINs checked, ${competitorAsins.length} competitor lookups, ${errors} errors`)
  return { synced, errors }
}
