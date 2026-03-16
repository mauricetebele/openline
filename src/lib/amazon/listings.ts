/**
 * Listings sync + shipping-template update logic.
 *
 * syncListings   — Downloads full catalog (FBA + MFN) via Reports API and upserts into DB
 * updateShippingTemplate — PATCHes a single SKU's shipping template via Listings API
 */
import axios from 'axios'
import { gunzip } from 'zlib'
import { promisify } from 'util'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'
import { syncCompetitivePricing } from './competitive-pricing'
import { syncFbaInventory } from './fba-inventory'

const gunzipAsync = promisify(gunzip)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Amazon flat-file condition codes → human-readable labels
const CONDITION_MAP: Record<string, string> = {
  '1':  'Used - Like New',
  '2':  'Used - Very Good',
  '3':  'Used - Good',
  '4':  'Used - Acceptable',
  '5':  'Collectible - Like New',
  '6':  'Collectible - Very Good',
  '7':  'Collectible - Good',
  '8':  'Collectible - Acceptable',
  '10': 'Refurbished',
  '11': 'New',
}

// ─── SP-API response shapes ───────────────────────────────────────────────────

interface CreateReportResponse {
  reportId: string
}

interface GetReportResponse {
  reportId: string
  reportType: string
  processingStatus: 'IN_QUEUE' | 'IN_PROGRESS' | 'DONE' | 'FATAL' | 'CANCELLED'
  reportDocumentId?: string
}

interface GetReportDocumentResponse {
  reportDocumentId: string
  url: string
  compressionAlgorithm?: string
}

// ─── syncListings ─────────────────────────────────────────────────────────────

export async function syncListings(accountId: string, jobId: string): Promise<void> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)

  // 1. Request report (all listings — includes Active, Inactive, Incomplete statuses)
  const reportType = 'GET_MERCHANT_LISTINGS_ALL_DATA'
  console.log(`[syncListings] Requesting report: ${reportType}`)
  const { reportId } = await client.post<CreateReportResponse>('/reports/2021-06-30/reports', {
    reportType,
    marketplaceIds: [account.marketplaceId],
  })

  // 2. Poll until DONE (max 20 attempts × 5 s = ~100 s)
  let reportDocumentId: string | undefined
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(5_000)
    const report = await client.get<GetReportResponse>(`/reports/2021-06-30/reports/${reportId}`)
    if (report.processingStatus === 'DONE') {
      reportDocumentId = report.reportDocumentId
      break
    }
    if (report.processingStatus === 'FATAL' || report.processingStatus === 'CANCELLED') {
      throw new Error(`Report ${reportId} ended with status ${report.processingStatus}`)
    }
  }

  if (!reportDocumentId) {
    throw new Error(`Report ${reportId} did not complete within the polling window`)
  }

  // 3. Get presigned S3 URL
  const docMeta = await client.get<GetReportDocumentResponse>(
    `/reports/2021-06-30/documents/${reportDocumentId}`,
  )

  // 4. Download — plain axios, NO auth headers (presigned S3)
  const response = await axios.get<ArrayBuffer>(docMeta.url, { responseType: 'arraybuffer' })
  let buffer = Buffer.from(response.data)

  // 5. Decompress if needed
  if (docMeta.compressionAlgorithm === 'GZIP') {
    buffer = await gunzipAsync(buffer)
  }

  // Strip UTF-8 BOM that Amazon sometimes includes in TSV reports
  const tsvText = buffer.toString('utf-8').replace(/^\uFEFF/, '')

  // 6. Parse TSV — include all listings (FBA + MFN)
  const lines = tsvText.split('\n')
  const headers = lines[0]?.split('\t').map((h) => h.trim().toLowerCase()) ?? []
  console.log('[syncListings] TSV headers:', headers.join(', '))

  const col = (row: string[], name: string) => {
    const idx = headers.indexOf(name)
    return idx >= 0 ? row[idx]?.trim() ?? '' : ''
  }

  const rows = lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => line.split('\t'))

  // 7. Parse all rows, then batch-upsert via raw SQL (single round-trip per batch)
  interface ParsedListing {
    sku: string
    asin: string | null
    productTitle: string | null
    condition: string | null
    fulfillmentChannel: string
    shippingTemplate: string | null
    listingStatus: string | null
    quantity: number
    price: number | null
    minPrice: number | null
    maxPrice: number | null
    fnsku: string | null
  }

  const parsed: ParsedListing[] = []

  for (const row of rows) {
    const sku = col(row, 'seller-sku')
    if (!sku) continue

    const asin = col(row, 'asin1') || null
    const productTitle = col(row, 'item-name') || null
    const fulfillmentChannel = col(row, 'fulfillment-channel') === 'DEFAULT' ? 'MFN' : 'FBA'
    const shippingTemplate = fulfillmentChannel === 'MFN'
      ? (col(row, 'merchant-shipping-group') || null)
      : null
    const listingStatus = col(row, 'status') || null
    const quantityRaw = parseInt(col(row, 'quantity'), 10)
    const quantity = isNaN(quantityRaw) ? 0 : quantityRaw
    const priceRaw = parseFloat(col(row, 'price'))
    const price = isNaN(priceRaw) ? null : priceRaw
    const minPriceRaw = parseFloat(col(row, 'minimum-seller-allowed-price'))
    const minPrice = isNaN(minPriceRaw) ? null : minPriceRaw
    const maxPriceRaw = parseFloat(col(row, 'maximum-seller-allowed-price'))
    const maxPrice = isNaN(maxPriceRaw) ? null : maxPriceRaw
    const conditionRaw = col(row, 'item-condition')
    const condition = conditionRaw ? (CONDITION_MAP[conditionRaw] ?? conditionRaw) : null

    const fnsku = col(row, 'fulfillment-channel-sku') || null

    parsed.push({ sku, asin, productTitle, condition, fulfillmentChannel, shippingTemplate, listingStatus, quantity, price, minPrice, maxPrice, fnsku })
  }

  const totalFound = rows.length
  let totalUpserted = 0
  const now = new Date()
  const BATCH_SIZE = 200

  for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
    const batch = parsed.slice(i, i + BATCH_SIZE)

    // Build VALUES clause: ($1,$2,...), ($14,$15,...), ...
    const values: unknown[] = []
    const placeholders: string[] = []
    for (const listing of batch) {
      const offset = values.length
      placeholders.push(
        `(gen_random_uuid(), $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15})`,
      )
      values.push(
        accountId,             // 1  accountId
        listing.sku,           // 2  sku
        listing.asin,          // 3  asin
        listing.productTitle,  // 4  productTitle
        listing.condition,     // 5  condition
        listing.fulfillmentChannel, // 6
        listing.shippingTemplate,   // 7
        listing.listingStatus, // 8
        listing.quantity,      // 9
        listing.price,         // 10
        listing.minPrice,      // 11
        listing.maxPrice,      // 12
        now,                   // 13 lastSyncedAt
        now,                   // 14 updatedAt
        listing.fnsku,         // 15 fnsku
      )
    }

    const sql = `
      INSERT INTO seller_listings (id, "accountId", sku, asin, "productTitle", condition, "fulfillmentChannel", "shippingTemplate", "listingStatus", quantity, price, "minPrice", "maxPrice", "lastSyncedAt", "updatedAt", fnsku)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT ("accountId", sku) DO UPDATE SET
        asin = EXCLUDED.asin,
        "productTitle" = EXCLUDED."productTitle",
        condition = EXCLUDED.condition,
        "fulfillmentChannel" = EXCLUDED."fulfillmentChannel",
        "shippingTemplate" = EXCLUDED."shippingTemplate",
        "listingStatus" = EXCLUDED."listingStatus",
        quantity = CASE WHEN EXCLUDED."fulfillmentChannel" = 'FBA' THEN seller_listings.quantity ELSE EXCLUDED.quantity END,
        price = EXCLUDED.price,
        "minPrice" = EXCLUDED."minPrice",
        "maxPrice" = EXCLUDED."maxPrice",
        "lastSyncedAt" = EXCLUDED."lastSyncedAt",
        "updatedAt" = EXCLUDED."updatedAt",
        fnsku = EXCLUDED.fnsku
    `

    await prisma.$executeRawUnsafe(sql, ...values)
    totalUpserted += batch.length

    await prisma.listingSyncJob.update({
      where: { id: jobId },
      data: { totalFound, totalUpserted },
    })
  }

  console.log(`[syncListings] Batch-upserted ${totalUpserted} listings in ${Math.ceil(parsed.length / BATCH_SIZE)} batches`)

  // 8. Mark listings not in the report as Inactive (they were deactivated/closed on Amazon)
  // Use `now` (the same timestamp written to lastSyncedAt during upsert) so that
  // only listings from *previous* syncs are marked Inactive — not the ones just synced.
  await prisma.sellerListing.updateMany({
    where: {
      accountId,
      lastSyncedAt: { lt: now },
      listingStatus: { not: 'Inactive' },
    },
    data: { listingStatus: 'Inactive' },
  })

  // 9. Sync FBA inventory quantities BEFORE marking job complete so the
  //    frontend sees accurate FBA quantities when it refreshes.
  try {
    await syncFbaInventory(accountId)
  } catch (err) {
    console.error(
      '[syncListings] FBA inventory sync failed:',
      err instanceof Error ? err.message : err,
    )
  }

  // 10. Mark job COMPLETED
  await prisma.listingSyncJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', totalFound, totalUpserted, completedAt: new Date() },
  })

  // 11. Refresh competitive pricing in the background.
  syncCompetitivePricing(accountId).catch((err) => {
    console.error(
      '[syncListings] competitive pricing background sync failed:',
      err instanceof Error ? err.message : err,
    )
  })
}

// ─── resolveTemplateGroupId ───────────────────────────────────────────────────
//
// The Listings Items API stores merchant_shipping_group as an internal UUID, not
// the display name shown in Seller Central / TSV reports.  To find the UUID for a
// given template name we GET any listing that is already using that template and
// read its merchant_shipping_group attribute value.

export async function resolveTemplateGroupId(
  accountId: string,
  templateName: string,
): Promise<string> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })

  // Sample listings that use this template from the most recent sync for this template.
  const samples = await prisma.sellerListing.findMany({
    where: {
      accountId,
      fulfillmentChannel: 'MFN',
      shippingTemplate: { equals: templateName, mode: 'insensitive' },
    },
    orderBy: { lastSyncedAt: 'desc' },
    take: 5,
  })

  if (samples.length === 0) {
    throw new Error(
      `Cannot resolve UUID for template "${templateName}": no listings from the most recent sync are assigned to it. ` +
      `Make sure at least one active MFN listing uses this template in Seller Central, then re-sync.`,
    )
  }

  const client = new SpApiClient(accountId)
  const uuidCounts = new Map<string, number>()

  for (const sample of samples) {
    const item = await client.get<ListingItemResponse>(
      `/listings/2021-08-01/items/${account.sellerId}/${encodeURIComponent(sample.sku)}`,
      { marketplaceIds: account.marketplaceId, includedData: 'attributes' },
    )
    const group = item.attributes?.merchant_shipping_group as
      | Array<{ value: string; marketplace_id: string }>
      | undefined
    const uuid =
      group?.find((g) => g.marketplace_id === account.marketplaceId)?.value
      ?? group?.[0]?.value
    if (uuid) uuidCounts.set(uuid, (uuidCounts.get(uuid) ?? 0) + 1)
  }

  if (uuidCounts.size === 0) {
    throw new Error(
      `Could not resolve UUID for template "${templateName}": sampled listings had no merchant_shipping_group attribute. ` +
      `Try re-syncing the catalog.`,
    )
  }

  // Take the most common UUID across samples.
  const [[uuid, count]] = [...uuidCounts.entries()].sort((a, b) => b[1] - a[1])

  if (uuidCounts.size > 1) {
    console.warn(
      `[resolveTemplateGroupId] Multiple UUIDs found for "${templateName}" across ${samples.length} recently-synced samples. ` +
      `Using most common: ${uuid} (${count}/${samples.length}).`,
    )
  }

  console.log(`[resolveTemplateGroupId] "${templateName}" → UUID ${uuid} (${count}/${samples.length} samples agree)`)
  return uuid
}

// ─── updateShippingTemplate ───────────────────────────────────────────────────

interface ListingItemResponse {
  summaries?: { marketplaceId: string; productType?: string }[]
  attributes?: Record<string, unknown>
}

interface ListingsPatchResponse {
  sku: string
  status: 'ACCEPTED' | 'INVALID'
  submissionId?: string
  issues?: {
    code: string
    message: string
    severity: 'ERROR' | 'WARNING' | 'INFO'
    attributeNames?: string[]
  }[]
}

export async function updateShippingTemplate(
  accountId: string,
  sku: string,
  templateName: string,
  templateGroupId?: string,
): Promise<void> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)
  const encodedSku = encodeURIComponent(sku)

  // 1. GET listing — fetch summaries (for product type) AND attributes (to see
  //    which attribute path Amazon is actually using for this listing).
  const listingItem = await client.get<ListingItemResponse>(
    `/listings/2021-08-01/items/${account.sellerId}/${encodedSku}`,
    { marketplaceIds: account.marketplaceId, includedData: 'summaries,attributes' },
  )

  const productType =
    listingItem.summaries?.find((s) => s.marketplaceId === account.marketplaceId)?.productType
    ?? listingItem.summaries?.[0]?.productType

  if (!productType) {
    throw new Error(
      `Could not determine product type for SKU ${sku}. ` +
      `summaries=${JSON.stringify(listingItem.summaries)}`,
    )
  }

  const attrs = listingItem.attributes ?? {}
  const attrKeys = Object.keys(attrs)
  console.log(`[updateShippingTemplate] SKU=${sku} productType=${productType} attrKeys=${attrKeys.join(',')}`)
  console.log(`[updateShippingTemplate] merchant_shipping_group value=${JSON.stringify(attrs.merchant_shipping_group)}`)
  console.log(`[updateShippingTemplate] fulfillment_availability value=${JSON.stringify(attrs.fulfillment_availability)}`)

  // 2. Build the patch.
  //    Amazon uses one of two attribute names depending on product type:
  //      - merchant_shipping_group      (most product types, confirmed via logs)
  //      - merchant_shipping_group_name (alternative name seen in some schemas)
  //    fulfillment_availability is NOT the right place — it accepts the patch but
  //    does not update the shipping template.
  const shippingAttr =
    'merchant_shipping_group' in attrs ? 'merchant_shipping_group'
    : 'merchant_shipping_group_name' in attrs ? 'merchant_shipping_group_name'
    : null

  let patches: object[]

  // Use the resolved UUID when available — Amazon stores merchant_shipping_group
  // as an internal UUID, not the display name shown in Seller Central.
  const patchValue = templateGroupId ?? templateName

  if (shippingAttr) {
    patches = [
      {
        op: 'replace',
        path: `/attributes/${shippingAttr}`,
        value: [{ value: patchValue, marketplace_id: account.marketplaceId }],
      },
    ]
  } else {
    // Attribute not yet set on this listing — use add (creates or replaces)
    patches = [
      {
        op: 'add',
        path: '/attributes/merchant_shipping_group',
        value: [{ value: patchValue, marketplace_id: account.marketplaceId }],
      },
    ]
  }

  let patchResult: ListingsPatchResponse
  try {
    patchResult = await client.patch<ListingsPatchResponse>(
      `/listings/2021-08-01/items/${account.sellerId}/${encodedSku}`,
      { productType, patches },
      { marketplaceIds: account.marketplaceId },
    )
  } catch (err: unknown) {
    const base = err instanceof Error ? err.message : String(err)
    throw new Error(
      `${base} — productType: ${productType}, attrKeys: [${attrKeys.join(', ')}]`,
    )
  }

  // Amazon returns HTTP 200 even when it rejects the patch — check the body status.
  if (patchResult.status === 'INVALID') {
    const errors = patchResult.issues
      ?.filter((i) => i.severity === 'ERROR')
      .map((i) => `${i.code}: ${i.message}${i.attributeNames?.length ? ` (${i.attributeNames.join(', ')})` : ''}`)
      .join('; ')
    throw new Error(
      `Amazon rejected patch (INVALID) — ${errors ?? 'no details'} — productType: ${productType}, attrKeys: [${attrKeys.join(', ')}]`,
    )
  }

  console.log(`[updateShippingTemplate] SKU=${sku} status=${patchResult.status} submissionId=${patchResult.submissionId}`)

  // Mirror the accepted change in DB immediately.
  // Note: Amazon processes ACCEPTED patches asynchronously — the change may take
  // a few minutes to appear in Seller Central / the live listing.
  await prisma.sellerListing.updateMany({
    where: { accountId, sku },
    data: { shippingTemplate: templateName, updatedAt: new Date() },
  })
}

// ─── createListing ───────────────────────────────────────────────────────────

interface ListingsPutResponse {
  sku: string
  status: 'ACCEPTED' | 'INVALID'
  submissionId?: string
  issues?: {
    code: string
    message: string
    severity: 'ERROR' | 'WARNING' | 'INFO'
    attributeNames?: string[]
  }[]
}

// SP-API condition_type values matching the Listings Items API attribute schema
const CONDITION_TYPE_MAP: Record<string, string> = {
  'New': 'new_new',
  'Used - Like New': 'used_like_new',
  'Used - Very Good': 'used_very_good',
  'Used - Good': 'used_good',
  'Used - Acceptable': 'used_acceptable',
  'Refurbished': 'refurbished_refurbished',
}

export async function createListing(
  accountId: string,
  sku: string,
  asin: string,
  price: number,
  quantity: number,
  fulfillmentChannel: 'MFN' | 'FBA',
  condition: string,
  shippingTemplateGroupId?: string,
): Promise<ListingsPutResponse> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)
  const encodedSku = encodeURIComponent(sku)

  const conditionType = CONDITION_TYPE_MAP[condition]
  if (!conditionType) {
    throw new Error(`Unknown condition: "${condition}". Valid values: ${Object.keys(CONDITION_TYPE_MAP).join(', ')}`)
  }

  const fulfillmentChannelCode = fulfillmentChannel === 'MFN' ? 'DEFAULT' : 'AMAZON_NA'

  // Build attributes
  const attributes: Record<string, unknown> = {
    merchant_suggested_asin: [{ value: asin, marketplace_id: account.marketplaceId }],
    condition_type: [{ value: conditionType, marketplace_id: account.marketplaceId }],
    purchasable_offer: [
      {
        audience: 'ALL',
        marketplace_id: account.marketplaceId,
        currency: 'USD',
        our_price: [{ schedule: [{ value_with_tax: price }] }],
      },
    ],
    fulfillment_availability: [
      {
        fulfillment_channel_code: fulfillmentChannelCode,
        quantity,
      },
    ],
  }

  // MFN listings require handling_time to activate the offer
  if (fulfillmentChannel === 'MFN') {
    attributes.handling_time = [{ value: 2, marketplace_id: account.marketplaceId }]
  }

  const body = {
    productType: 'PRODUCT',
    requirements: 'LISTING_OFFER_ONLY',
    attributes,
  }

  const result = await client.put<ListingsPutResponse>(
    `/listings/2021-08-01/items/${account.sellerId}/${encodedSku}`,
    body,
    { marketplaceIds: account.marketplaceId },
  )

  if (result.status === 'INVALID') {
    const errors = result.issues
      ?.filter((i) => i.severity === 'ERROR')
      .map((i) => `${i.code}: ${i.message}${i.attributeNames?.length ? ` (${i.attributeNames.join(', ')})` : ''}`)
      .join('; ')
    throw new Error(`Amazon rejected listing (INVALID) — ${errors ?? 'no details'}`)
  }

  console.log(`[createListing] SKU=${sku} ASIN=${asin} status=${result.status} submissionId=${result.submissionId}`)

  // Brief wait for Amazon to process the PUT before follow-up PATCHes
  await new Promise((r) => setTimeout(r, 5000))

  // Fetch the listing to get the real product type assigned by Amazon.
  // Using generic 'PRODUCT' in PATCH causes Amazon to silently ignore the update.
  let realProductType = 'PRODUCT'
  try {
    const listingItem = await client.get<{ summaries?: Array<{ productType?: string }> }>(
      `/listings/2021-08-01/items/${account.sellerId}/${encodedSku}`,
      { marketplaceIds: account.marketplaceId, includedData: 'summaries' },
    )
    const fetched = listingItem.summaries?.[0]?.productType
    if (fetched) {
      realProductType = fetched
      console.log(`[createListing] resolved productType=${realProductType} for SKU=${sku}`)
    }
  } catch (fetchErr) {
    console.error(`[createListing] could not fetch productType for SKU=${sku}, using PRODUCT:`, fetchErr)
  }

  // Follow-up PATCH to explicitly set purchasable_offer — Amazon's PUT with
  // LISTING_OFFER_ONLY sometimes creates the listing skeleton without applying
  // the offer attributes (price), resulting in "Missing Offer" / $0.00 on Seller Central.
  try {
    const patchResult = await client.patch<ListingsPatchResponse>(
      `/listings/2021-08-01/items/${account.sellerId}/${encodedSku}`,
      {
        productType: realProductType,
        patches: [
          {
            op: 'replace',
            path: '/attributes/purchasable_offer',
            value: [
              {
                audience: 'ALL',
                marketplace_id: account.marketplaceId,
                currency: 'USD',
                our_price: [{ schedule: [{ value_with_tax: price }] }],
              },
            ],
          },
        ],
      },
      { marketplaceIds: account.marketplaceId },
    )
    console.log(`[createListing] follow-up PATCH SKU=${sku} status=${patchResult.status}`)
  } catch (patchErr) {
    console.error(`[createListing] follow-up price PATCH failed for SKU=${sku} (non-fatal):`, patchErr)
  }

  // Follow-up PATCH to set shipping template — LISTING_OFFER_ONLY ignores
  // merchant_shipping_group in the initial PUT, so we apply it separately.
  if (shippingTemplateGroupId && fulfillmentChannel === 'MFN') {
    try {
      const templatePatch = await client.patch<ListingsPatchResponse>(
        `/listings/2021-08-01/items/${account.sellerId}/${encodedSku}`,
        {
          productType: realProductType,
          patches: [
            {
              op: 'replace',
              path: '/attributes/merchant_shipping_group',
              value: [{ value: shippingTemplateGroupId, marketplace_id: account.marketplaceId }],
            },
          ],
        },
        { marketplaceIds: account.marketplaceId },
      )
      console.log(`[createListing] shipping template PATCH SKU=${sku} status=${templatePatch.status}`)
    } catch (templateErr) {
      console.error(`[createListing] shipping template PATCH failed for SKU=${sku} (non-fatal):`, templateErr)
    }
  }

  // Upsert into seller_listings
  const now = new Date()
  await prisma.$executeRawUnsafe(
    `INSERT INTO seller_listings (id, "accountId", sku, asin, condition, "fulfillmentChannel", "listingStatus", quantity, price, "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'Active', $6, $7, $8)
     ON CONFLICT ("accountId", sku) DO UPDATE SET
       asin = EXCLUDED.asin,
       condition = EXCLUDED.condition,
       "fulfillmentChannel" = EXCLUDED."fulfillmentChannel",
       "listingStatus" = EXCLUDED."listingStatus",
       quantity = EXCLUDED.quantity,
       price = EXCLUDED.price,
       "updatedAt" = EXCLUDED."updatedAt"`,
    accountId, sku, asin, condition, fulfillmentChannel, quantity, price, now,
  )

  return result
}

// ─── updateListingPrice ──────────────────────────────────────────────────────

export async function updateListingPrice(
  accountId: string,
  sku: string,
  newPrice: number,
): Promise<void> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)
  const encodedSku = encodeURIComponent(sku)

  // 1. GET listing to determine productType
  const listingItem = await client.get<ListingItemResponse>(
    `/listings/2021-08-01/items/${account.sellerId}/${encodedSku}`,
    { marketplaceIds: account.marketplaceId, includedData: 'summaries' },
  )

  const productType =
    listingItem.summaries?.find((s) => s.marketplaceId === account.marketplaceId)?.productType
    ?? listingItem.summaries?.[0]?.productType

  if (!productType) {
    throw new Error(
      `Could not determine product type for SKU ${sku}. ` +
      `summaries=${JSON.stringify(listingItem.summaries)}`,
    )
  }

  // 2. PATCH with purchasable_offer attribute
  const patches = [
    {
      op: 'replace',
      path: '/attributes/purchasable_offer',
      value: [
        {
          audience: 'ALL',
          marketplace_id: account.marketplaceId,
          currency: 'USD',
          our_price: [{ schedule: [{ value_with_tax: newPrice }] }],
        },
      ],
    },
  ]

  let patchResult: ListingsPatchResponse
  try {
    patchResult = await client.patch<ListingsPatchResponse>(
      `/listings/2021-08-01/items/${account.sellerId}/${encodedSku}`,
      { productType, patches },
      { marketplaceIds: account.marketplaceId },
    )
  } catch (err: unknown) {
    const base = err instanceof Error ? err.message : String(err)
    throw new Error(`${base} — productType: ${productType}`)
  }

  if (patchResult.status === 'INVALID') {
    const errors = patchResult.issues
      ?.filter((i) => i.severity === 'ERROR')
      .map((i) => `${i.code}: ${i.message}${i.attributeNames?.length ? ` (${i.attributeNames.join(', ')})` : ''}`)
      .join('; ')
    throw new Error(
      `Amazon rejected price update (INVALID) — ${errors ?? 'no details'} — productType: ${productType}`,
    )
  }

  console.log(`[updateListingPrice] SKU=${sku} price=${newPrice} status=${patchResult.status} submissionId=${patchResult.submissionId}`)

  // Mirror new price in DB immediately.
  await prisma.sellerListing.updateMany({
    where: { accountId, sku },
    data: { price: newPrice, updatedAt: new Date() },
  })
}

// ─── updateListingQuantity ─────────────────────────────────────────────────

export async function updateListingQuantity(
  accountId: string,
  sku: string,
  quantity: number,
): Promise<void> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)
  const encodedSku = encodeURIComponent(sku)

  // 1. GET listing to determine productType
  const listingItem = await client.get<ListingItemResponse>(
    `/listings/2021-08-01/items/${account.sellerId}/${encodedSku}`,
    { marketplaceIds: account.marketplaceId, includedData: 'summaries' },
  )

  const productType =
    listingItem.summaries?.find((s) => s.marketplaceId === account.marketplaceId)?.productType
    ?? listingItem.summaries?.[0]?.productType

  if (!productType) {
    throw new Error(
      `Could not determine product type for SKU ${sku}. ` +
      `summaries=${JSON.stringify(listingItem.summaries)}`,
    )
  }

  // 2. PATCH with fulfillment_availability attribute
  const patches = [
    {
      op: 'replace',
      path: '/attributes/fulfillment_availability',
      value: [
        {
          fulfillment_channel_code: 'DEFAULT',
          quantity,
        },
      ],
    },
  ]

  let patchResult: ListingsPatchResponse
  try {
    patchResult = await client.patch<ListingsPatchResponse>(
      `/listings/2021-08-01/items/${account.sellerId}/${encodedSku}`,
      { productType, patches },
      { marketplaceIds: account.marketplaceId },
    )
  } catch (err: unknown) {
    const base = err instanceof Error ? err.message : String(err)
    throw new Error(`${base} — productType: ${productType}`)
  }

  if (patchResult.status === 'INVALID') {
    const errors = patchResult.issues
      ?.filter((i) => i.severity === 'ERROR')
      .map((i) => `${i.code}: ${i.message}${i.attributeNames?.length ? ` (${i.attributeNames.join(', ')})` : ''}`)
      .join('; ')
    throw new Error(
      `Amazon rejected quantity update (INVALID) — ${errors ?? 'no details'} — productType: ${productType}`,
    )
  }

  console.log(`[updateListingQuantity] SKU=${sku} qty=${quantity} status=${patchResult.status} submissionId=${patchResult.submissionId}`)

  // Mirror new quantity in DB immediately.
  await prisma.sellerListing.updateMany({
    where: { accountId, sku },
    data: { quantity, updatedAt: new Date() },
  })
}
