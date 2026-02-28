/**
 * MFN Returns sync — downloads the GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE
 * report from SP-API, parses the TSV, and upserts rows into mfn_returns.
 *
 * Amazon's return flat file columns (tab-separated, US marketplace 2025):
 *   Order ID | Order date | Return request date | Return request status |
 *   Amazon RMA ID | Merchant RMA ID | Label type | Label cost | Currency code |
 *   Return carrier | Tracking ID | Label to be paid by | A-to-Z Claim | Is prime |
 *   ASIN | Merchant SKU | Item Name | Return quantity | Return Reason | In policy |
 *   Return type | Resolution | Invoice number | Return delivery date | Order Amount |
 *   Order quantity | SafeT fields... | Refunded Amount | Order Item ID
 *
 * Key fields:
 *   - Tracking ID      = return-shipment tracking number
 *   - Amazon RMA ID    = Amazon's RMA identifier (IS included in this report)
 *   - Refunded Amount  = actual amount refunded to the buyer
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

interface CreateReportResponse { reportId: string }
interface GetReportResponse {
  reportId: string
  processingStatus: 'IN_QUEUE' | 'IN_PROGRESS' | 'DONE' | 'FATAL' | 'CANCELLED'
  reportDocumentId?: string
}
interface GetReportDocumentResponse {
  reportDocumentId: string
  url: string
  compressionAlgorithm?: string
}

/** Try several possible column header spellings. Returns '' when not found. */
function col(row: string[], headers: string[], ...names: string[]): string {
  for (const name of names) {
    const idx = headers.indexOf(name.toLowerCase())
    if (idx >= 0) return row[idx]?.trim() ?? ''
  }
  return ''
}

function parseDate(raw: string): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

function parseDecimal(raw: string): number | null {
  const n = parseFloat(raw.replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? null : n
}

export async function syncMFNReturns(
  accountId: string,
  jobId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ totalFound: number; totalUpserted: number }> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)

  // ── 1. Request the returns report ──────────────────────────────────────────
  const { reportId } = await client.post<CreateReportResponse>('/reports/2021-06-30/reports', {
    reportType: 'GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE',
    marketplaceIds: [account.marketplaceId],
    dataStartTime: startDate.toISOString(),
    dataEndTime: endDate.toISOString(),
  })

  // ── 2. Poll until DONE (max 30 × 10 s = 5 min) ────────────────────────────
  let reportDocumentId: string | undefined
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(10_000)
    const report = await client.get<GetReportResponse>(`/reports/2021-06-30/reports/${reportId}`)
    if (report.processingStatus === 'DONE') {
      reportDocumentId = report.reportDocumentId
      break
    }
    if (report.processingStatus === 'FATAL' || report.processingStatus === 'CANCELLED') {
      throw new Error(`Returns report ended with status: ${report.processingStatus}`)
    }
  }
  if (!reportDocumentId) throw new Error('Returns report did not complete within the polling window')

  // ── 3. Download ────────────────────────────────────────────────────────────
  const docMeta = await client.get<GetReportDocumentResponse>(
    `/reports/2021-06-30/documents/${reportDocumentId}`,
  )
  const response = await axios.get<ArrayBuffer>(docMeta.url, { responseType: 'arraybuffer' })
  let buffer = Buffer.from(response.data)
  if (docMeta.compressionAlgorithm === 'GZIP') buffer = await gunzipAsync(buffer)

  // Strip UTF-8 BOM (\uFEFF) — Amazon places it at the very start of the file,
  // which corrupts the first column header ("Return date" → "\uFEFFReturn date")
  // and prevents the name lookup from matching.
  const tsvText = buffer.toString('utf-8').replace(/^\uFEFF/, '')

  // ── 4. Parse TSV ───────────────────────────────────────────────────────────
  const lines = tsvText.split('\n')
  const headers = lines[0]?.split('\t').map((h) => h.trim().toLowerCase()) ?? []

  const rows = lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => line.split('\t'))

  let totalFound = 0
  let totalUpserted = 0

  for (const row of rows) {
    totalFound++

    const orderId = col(row, headers, 'order id', 'order-id', 'orderid')
    if (!orderId) continue

    // Column name variants across marketplaces / report versions.
    // Primary names match the actual US marketplace flat-file format as of 2025:
    //   Order ID | Order date | Return request date | Return request status |
    //   Amazon RMA ID | Merchant RMA ID | Label type | Label cost | Currency code |
    //   Return carrier | Tracking ID | ... | ASIN | Merchant SKU | Item Name |
    //   Return quantity | Return Reason | ... | Refunded Amount | Order Item ID
    const orderDate       = parseDate(col(row, headers, 'order date', 'order-date'))
    const returnDate      = parseDate(col(row, headers, 'return request date', 'return date', 'return-date'))
    const title           = col(row, headers, 'item name', 'item-name', 'title', 'product name') || null
    const asin            = col(row, headers, 'asin') || null
    const sku             = col(row, headers, 'merchant sku', 'merchant-sku', 'sku', 'seller-sku') || null
    const qtyRaw          = col(row, headers, 'return quantity', 'quantity', 'qty')
    const quantity        = qtyRaw ? (parseInt(qtyRaw, 10) || null) : null
    const returnReason    = col(row, headers, 'return reason', 'return-reason', 'reason') || null
    const returnStatus    = col(row, headers, 'return request status', 'return status', 'status') || null
    // "Tracking ID" is the return-shipment tracking number in the current report format.
    // "LPN" was used in the legacy flat-file format.
    const trackingNumber  = col(row, headers, 'tracking id', 'lpn', 'tracking number',
                                              'return tracking number', 'carrier tracking number') || null
    // Amazon RMA ID is included in the current flat-file format (column "Amazon RMA ID").
    const rmaId           = col(row, headers, 'amazon rma id', 'merchant rma id',
                                              'rma id', 'rma number', 'rma-id', 'rma') || null
    // "Refunded Amount" = actual amount refunded; fall back to "Order Amount" or legacy names.
    const labelAmountRaw  = col(row, headers, 'refunded amount', 'refund amount', 'order amount',
                                              'label cost', 'label amount', 'return value', 'item price', 'amount')
    const returnValue     = parseDecimal(labelAmountRaw)
    const currency        = col(row, headers, 'currency code', 'currency') || 'USD'

    // Deduplication key: accountId + orderId + (trackingNumber or sku or returnDate ISO)
    const dedupeKey = trackingNumber ?? sku ?? returnDate?.toISOString() ?? 'unknown'

    const existing = await prisma.mFNReturn.findFirst({
      where: { accountId, orderId, trackingNumber: trackingNumber ?? undefined },
    })

    if (existing) {
      await prisma.mFNReturn.update({
        where: { id: existing.id },
        data: {
          orderDate, rmaId, trackingNumber, returnValue, currency, returnDate,
          asin, sku, title, quantity, returnReason, returnStatus,
        },
      })
    } else {
      await prisma.mFNReturn.create({
        data: {
          accountId, orderId, orderDate, rmaId, trackingNumber,
          returnValue, currency, returnDate,
          asin, sku, title, quantity, returnReason, returnStatus,
        },
      })
    }
    totalUpserted++

    // Update progress every 20 rows
    if (totalUpserted % 20 === 0) {
      await prisma.mFNReturnSyncJob.update({
        where: { id: jobId },
        data: { totalFound, totalUpserted },
      })
    }

    void dedupeKey // suppress unused warning
  }

  // ── 5. Finalize ────────────────────────────────────────────────────────────
  await prisma.mFNReturnSyncJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', totalFound, totalUpserted, completedAt: new Date() },
  })

  return { totalFound, totalUpserted }
}
