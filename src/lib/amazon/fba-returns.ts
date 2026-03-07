/**
 * FBA Returns sync — downloads the GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA
 * report from SP-API, parses the TSV, and upserts rows into fba_returns.
 *
 * Follows the same request→poll→download→parse pattern as mfn-returns.ts.
 *
 * Key TSV columns:
 *   order-id | sku | fnsku | asin | product-name | quantity |
 *   status (e.g. "Unit returned to inventory") | status-change-date |
 *   return-date | detailed-disposition | fulfillment-center-id
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

export async function syncFbaReturns(
  accountId: string,
  jobId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ totalFound: number; totalUpserted: number }> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)

  // ── 1. Request the returns report ──────────────────────────────────────────
  const { reportId } = await client.post<CreateReportResponse>('/reports/2021-06-30/reports', {
    reportType: 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA',
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
      throw new Error(`FBA returns report ended with status: ${report.processingStatus}`)
    }
  }
  if (!reportDocumentId) throw new Error('FBA returns report did not complete within the polling window')

  // ── 3. Download ────────────────────────────────────────────────────────────
  const docMeta = await client.get<GetReportDocumentResponse>(
    `/reports/2021-06-30/documents/${reportDocumentId}`,
  )
  const response = await axios.get<ArrayBuffer>(docMeta.url, { responseType: 'arraybuffer' })
  let buffer = Buffer.from(response.data)
  if (docMeta.compressionAlgorithm === 'GZIP') buffer = await gunzipAsync(buffer)

  // Strip UTF-8 BOM
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

    const sku                 = col(row, headers, 'sku', 'seller-sku', 'merchant sku', 'merchant-sku') || ''
    const fnsku               = col(row, headers, 'fnsku', 'fn-sku') || null
    const asin                = col(row, headers, 'asin') || null
    const title               = col(row, headers, 'product-name', 'product name', 'item name', 'title') || null
    const qtyRaw              = col(row, headers, 'quantity', 'return quantity', 'qty')
    const quantity            = qtyRaw ? (parseInt(qtyRaw, 10) || null) : null
    const returnDate          = parseDate(col(row, headers, 'return-date', 'return date'))
    const status              = col(row, headers, 'status', 'return status', 'detailed-disposition-status') || null
    const statusChangeDate    = parseDate(col(row, headers, 'status-change-date', 'status change date'))
    const detailedDisposition = col(row, headers, 'detailed-disposition', 'detailed disposition') || null
    const fulfillmentCenterId = col(row, headers, 'fulfillment-center-id', 'fulfillment center id', 'fc-id') || null
    const lpn                 = col(row, headers, 'license-plate-number', 'lpn-condition', 'lpn') || null

    // Upsert using the composite unique key: accountId + orderId + sku
    await prisma.fbaReturn.upsert({
      where: {
        accountId_orderId_sku: { accountId, orderId, sku },
      },
      create: {
        accountId, orderId, sku, fnsku, asin, title, quantity,
        returnDate, status, statusChangeDate, detailedDisposition, fulfillmentCenterId, lpn,
      },
      update: {
        fnsku, asin, title, quantity,
        returnDate, status, statusChangeDate, detailedDisposition, fulfillmentCenterId, lpn,
      },
    })
    totalUpserted++

    // Update progress every 20 rows
    if (totalUpserted % 20 === 0) {
      await prisma.importJob.update({
        where: { id: jobId },
        data: { totalFound, totalUpserted },
      })
    }
  }

  // ── 5. Finalize ────────────────────────────────────────────────────────────
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', totalFound, totalUpserted, completedAt: new Date() },
  })

  return { totalFound, totalUpserted }
}
