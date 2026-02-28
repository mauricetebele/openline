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

  // 1. Request report
  const { reportId } = await client.post<CreateReportResponse>('/reports/2021-06-30/reports', {
    reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
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

  const tsvText = buffer.toString('utf-8')

  // 6. Parse TSV — include all listings (FBA + MFN)
  const lines = tsvText.split('\n')
  const headers = lines[0]?.split('\t').map((h) => h.trim().toLowerCase()) ?? []

  const col = (row: string[], name: string) => {
    const idx = headers.indexOf(name)
    return idx >= 0 ? row[idx]?.trim() ?? '' : ''
  }

  const rows = lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => line.split('\t'))

  // 7. Upsert each listing (FBA + MFN)
  let totalFound = 0
  let totalUpserted = 0

  for (const row of rows) {
    totalFound++
    const sku = col(row, 'seller-sku')
    if (!sku) continue

    const asin = col(row, 'asin1') || null
    const productTitle = col(row, 'item-name') || null
    // 'DEFAULT' = merchant-fulfilled (MFN); anything else (e.g. 'AMAZON_NA') = FBA
    const fulfillmentChannel = col(row, 'fulfillment-channel') === 'DEFAULT' ? 'MFN' : 'FBA'
    // MFN listings have a shipping template; FBA listings do not
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

    await prisma.sellerListing.upsert({
      where: { accountId_sku: { accountId, sku } },
      create: {
        accountId,
        sku,
        asin,
        productTitle,
        condition,
        fulfillmentChannel,
        shippingTemplate,
        listingStatus,
        quantity,
        price,
        minPrice,
        maxPrice,
        lastSyncedAt: new Date(),
      },
      update: {
        // groupName is intentionally excluded — it is a local assignment and
        // must never be overwritten by data coming from Amazon.
        asin,
        productTitle,
        condition,
        fulfillmentChannel,
        shippingTemplate,
        listingStatus,
        quantity,
        price,
        minPrice,
        maxPrice,
        lastSyncedAt: new Date(),
      },
    })
    totalUpserted++
  }

  // 8. Mark job COMPLETED
  await prisma.listingSyncJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', totalFound, totalUpserted, completedAt: new Date() },
  })

  // 9. Refresh competitive pricing + FBA inventory in the background.
  syncCompetitivePricing(accountId).catch((err) => {
    console.error(
      '[syncListings] competitive pricing background sync failed:',
      err instanceof Error ? err.message : err,
    )
  })

  syncFbaInventory(accountId).catch((err) => {
    console.error(
      '[syncListings] FBA inventory background sync failed:',
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

  // Only sample listings from the most recent sync batch.
  // Listings not included in the latest TSV (e.g. inactive/removed) keep their old
  // lastSyncedAt and shippingTemplate — those stale entries would return wrong UUIDs.
  const latestSync = await prisma.sellerListing.findFirst({
    where: { accountId },
    orderBy: { lastSyncedAt: 'desc' },
    select: { lastSyncedAt: true },
  })

  if (!latestSync) {
    throw new Error(`No synced listings found for this account. Run a catalog sync first.`)
  }

  // 30-minute window covers the full duration of even a large sync job
  const syncBatchCutoff = new Date(latestSync.lastSyncedAt.getTime() - 30 * 60 * 1000)

  const samples = await prisma.sellerListing.findMany({
    where: {
      accountId,
      fulfillmentChannel: 'MFN',
      shippingTemplate: templateName,
      lastSyncedAt: { gte: syncBatchCutoff },
    },
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
