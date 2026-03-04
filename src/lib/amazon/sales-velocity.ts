/**
 * Sales velocity sync via Amazon Reports API.
 *
 * Uses GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL to fetch all orders
 * (FBA + MFN, all statuses) for the last 7 days. Parses the TSV and
 * caches per-SKU velocity (sold24h / sold3d / sold7d) on SellerListing rows.
 */
import axios from 'axios'
import { gunzip } from 'zlib'
import { promisify } from 'util'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'

const gunzipAsync = promisify(gunzip)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── SP-API response shapes (shared with listings.ts) ─────────────────────

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

// ─── syncSalesVelocity ────────────────────────────────────────────────────

export interface VelocitySyncResult {
  skusUpdated: number
  skusReset: number
  totalOrderRows: number
}

export async function syncSalesVelocity(accountId: string): Promise<VelocitySyncResult> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  // 1. Request report
  const { reportId } = await client.post<CreateReportResponse>('/reports/2021-06-30/reports', {
    reportType: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',
    marketplaceIds: [account.marketplaceId],
    dataStartTime: sevenDaysAgo.toISOString(),
    dataEndTime: now.toISOString(),
  })

  console.log(`[syncSalesVelocity] Report requested: ${reportId}`)

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

  // 6. Parse TSV
  const lines = tsvText.split('\n')
  const headers = lines[0]?.split('\t').map((h) => h.trim().toLowerCase()) ?? []
  console.log('[syncSalesVelocity] TSV headers:', headers.join(', '))
  console.log('[syncSalesVelocity] Total data rows:', lines.length - 1)

  const col = (row: string[], ...names: string[]) => {
    for (const name of names) {
      const idx = headers.indexOf(name)
      if (idx >= 0) return row[idx]?.trim() ?? ''
    }
    return ''
  }

  const rows = lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => line.split('\t'))

  // 7. Build velocity map: sku → { sold24h, sold3d, sold7d }
  const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

  type VelocityBucket = { sold24h: number; sold3d: number; sold7d: number }
  const velocityMap = new Map<string, VelocityBucket>()

  let totalOrderRows = 0

  for (const row of rows) {
    const sku = col(row, 'sku', 'seller-sku')
    if (!sku) continue

    const quantityRaw = parseInt(col(row, 'quantity-purchased', 'quantity'), 10)
    const quantity = isNaN(quantityRaw) ? 0 : quantityRaw
    if (quantity <= 0) continue

    const purchaseDateStr = col(row, 'purchase-date', 'last-updated-date')
    if (!purchaseDateStr) continue
    const purchaseDate = new Date(purchaseDateStr)
    if (isNaN(purchaseDate.getTime())) continue

    // Skip cancelled orders
    const orderStatus = col(row, 'order-status', 'item-status')
    if (orderStatus.toLowerCase() === 'cancelled') continue

    totalOrderRows++

    const bucket = velocityMap.get(sku) ?? { sold24h: 0, sold3d: 0, sold7d: 0 }
    if (purchaseDate >= oneDayAgo) bucket.sold24h += quantity
    if (purchaseDate >= threeDaysAgo) bucket.sold3d += quantity
    bucket.sold7d += quantity
    velocityMap.set(sku, bucket)
  }

  console.log(`[syncSalesVelocity] Parsed ${totalOrderRows} order rows across ${velocityMap.size} SKUs`)

  // 8. Batch-update SellerListing rows with velocity data
  const syncedAt = new Date()
  const velocityEntries = Array.from(velocityMap.entries())

  // Build a single UPDATE using a VALUES list joined to the table
  const BATCH_SIZE = 200
  let skusUpdated = 0

  for (let i = 0; i < velocityEntries.length; i += BATCH_SIZE) {
    const batch = velocityEntries.slice(i, i + BATCH_SIZE)
    const values: unknown[] = []
    const placeholders: string[] = []

    for (const [sku, bucket] of batch) {
      const offset = values.length
      placeholders.push(`($${offset + 1}, $${offset + 2}::int, $${offset + 3}::int, $${offset + 4}::int)`)
      values.push(sku, bucket.sold24h, bucket.sold3d, bucket.sold7d)
    }

    const sql = `
      UPDATE seller_listings AS sl SET
        "sold24h" = v.sold24h,
        "sold3d" = v.sold3d,
        "sold7d" = v.sold7d,
        "velocitySyncedAt" = $${values.length + 1}
      FROM (VALUES ${placeholders.join(', ')}) AS v(sku, sold24h, sold3d, sold7d)
      WHERE sl."accountId" = $${values.length + 2} AND sl.sku = v.sku
    `
    values.push(syncedAt, accountId)

    await prisma.$executeRawUnsafe(sql, ...values)
    skusUpdated += batch.length
  }

  // 9. Reset SKUs NOT in the report to 0 (no sales in last 7 days)
  const { count: skusReset } = await prisma.sellerListing.updateMany({
    where: {
      accountId,
      sku: { notIn: Array.from(velocityMap.keys()) },
      // Only reset rows that previously had velocity data
      OR: [
        { sold24h: { gt: 0 } },
        { sold3d: { gt: 0 } },
        { sold7d: { gt: 0 } },
      ],
    },
    data: {
      sold24h: 0,
      sold3d: 0,
      sold7d: 0,
      velocitySyncedAt: syncedAt,
    },
  })

  console.log(`[syncSalesVelocity] Updated ${skusUpdated} SKUs, reset ${skusReset} SKUs with no recent sales`)

  return { skusUpdated, skusReset, totalOrderRows }
}
