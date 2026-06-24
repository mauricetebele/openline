/**
 * FBA Removal Order sync — downloads the
 * GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA report from SP-API,
 * parses the TSV, and upserts rows into removal_shipments / removal_shipment_items.
 *
 * Report columns:
 *   request-date | order-id | order-source | order-type | order-status |
 *   last-updated-date | sku | fnsku | disposition | requested-quantity |
 *   cancelled-quantity | disposed-quantity | shipped-quantity |
 *   in-process-quantity | removal-fee | currency
 *
 * Rows are grouped by order-id → one RemovalShipment per order,
 * each SKU line becomes a RemovalShipmentItem with quantity breakdowns.
 */
import axios from 'axios'
import { gunzip } from 'zlib'
import { promisify } from 'util'
import { Decimal } from '@prisma/client/runtime/library'
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

function parseIntSafe(raw: string): number {
  const n = parseInt(raw, 10)
  return isNaN(n) ? 0 : n
}

function parseDecimal(raw: string): Decimal | null {
  if (!raw) return null
  const n = parseFloat(raw)
  return isNaN(n) ? null : new Decimal(n)
}

interface ParsedRow {
  removalOrderId: string
  orderType: string | null
  orderStatus: string | null
  orderSource: string | null
  requestDate: Date | null
  lastUpdatedDate: Date | null
  sellerSku: string
  fnsku: string
  disposition: string | null
  requestedQty: number
  cancelledQty: number
  disposedQty: number
  shippedQty: number
  inProcessQty: number
  removalFee: Decimal | null
  currency: string | null
}

export async function syncRemovalShipments(
  accountId: string,
  jobId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ totalFound: number; totalUpserted: number }> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)

  const reportType = 'GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA'

  // ── 1. Check for a recent completed report we can reuse ───────────────────
  let reportDocumentId: string | undefined

  const existing = await client.get<{ reports: GetReportResponse[] }>(
    `/reports/2021-06-30/reports?reportTypes=${reportType}&pageSize=5&processingStatuses=DONE`,
  )
  if (existing.reports.length > 0 && existing.reports[0].reportDocumentId) {
    // Use the most recent completed report
    reportDocumentId = existing.reports[0].reportDocumentId
  }

  // ── 2. If no existing report, request a new one ───────────────────────────
  if (!reportDocumentId) {
    const { reportId } = await client.post<CreateReportResponse>('/reports/2021-06-30/reports', {
      reportType,
      marketplaceIds: [account.marketplaceId],
      dataStartTime: startDate.toISOString(),
      dataEndTime: endDate.toISOString(),
    })

    // Poll until DONE (max 30 × 10 s = 5 min)
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(10_000)
      const report = await client.get<GetReportResponse>(`/reports/2021-06-30/reports/${reportId}`)
      if (report.processingStatus === 'DONE') {
        reportDocumentId = report.reportDocumentId
        break
      }
      if (report.processingStatus === 'FATAL' || report.processingStatus === 'CANCELLED') {
        throw new Error(`Removal order report ended with status: ${report.processingStatus}`)
      }
    }
    if (!reportDocumentId) throw new Error('Removal order report did not complete within the polling window')
  }

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

  const rawRows = lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => line.split('\t'))

  const parsed: ParsedRow[] = []
  for (const row of rawRows) {
    const removalOrderId = col(row, headers, 'order-id', 'order id', 'orderid')
    if (!removalOrderId) continue

    parsed.push({
      removalOrderId,
      orderType:       col(row, headers, 'order-type', 'order type') || null,
      orderStatus:     col(row, headers, 'order-status', 'order status') || null,
      orderSource:     col(row, headers, 'order-source', 'order source') || null,
      requestDate:     parseDate(col(row, headers, 'request-date', 'request date')),
      lastUpdatedDate: parseDate(col(row, headers, 'last-updated-date', 'last updated date')),
      sellerSku:       col(row, headers, 'sku', 'seller-sku') || '',
      fnsku:           col(row, headers, 'fnsku', 'fn-sku') || '',
      disposition:     col(row, headers, 'disposition') || null,
      requestedQty:    parseIntSafe(col(row, headers, 'requested-quantity', 'requested quantity')),
      cancelledQty:    parseIntSafe(col(row, headers, 'cancelled-quantity', 'cancelled quantity')),
      disposedQty:     parseIntSafe(col(row, headers, 'disposed-quantity', 'disposed quantity')),
      shippedQty:      parseIntSafe(col(row, headers, 'shipped-quantity', 'shipped quantity')),
      inProcessQty:    parseIntSafe(col(row, headers, 'in-process-quantity', 'in-process quantity')),
      removalFee:      parseDecimal(col(row, headers, 'removal-fee', 'removal fee')),
      currency:        col(row, headers, 'currency') || null,
    })
  }

  // ── 5. Group by order-id and upsert ────────────────────────────────────────
  const groups = new Map<string, ParsedRow[]>()
  for (const row of parsed) {
    if (!groups.has(row.removalOrderId)) groups.set(row.removalOrderId, [])
    groups.get(row.removalOrderId)!.push(row)
  }

  let totalFound = parsed.length
  let totalUpserted = 0

  const groupEntries = Array.from(groups.values())
  for (const groupRows of groupEntries) {
    const first = groupRows[0]

    // Upsert the removal order header
    const order = await prisma.removalShipment.upsert({
      where: {
        accountId_removalOrderId: {
          accountId,
          removalOrderId: first.removalOrderId,
        },
      },
      create: {
        accountId,
        removalOrderId: first.removalOrderId,
        orderType: first.orderType,
        orderStatus: first.orderStatus,
        orderSource: first.orderSource,
        requestDate: first.requestDate,
        lastUpdatedDate: first.lastUpdatedDate,
      },
      update: {
        orderType: first.orderType,
        orderStatus: first.orderStatus,
        orderSource: first.orderSource,
        requestDate: first.requestDate,
        lastUpdatedDate: first.lastUpdatedDate,
      },
    })

    // Upsert each SKU line item
    for (const row of groupRows) {
      await prisma.removalShipmentItem.upsert({
        where: {
          shipmentId_sellerSku_fnsku: {
            shipmentId: order.id,
            sellerSku: row.sellerSku,
            fnsku: row.fnsku,
          },
        },
        create: {
          shipmentId: order.id,
          sellerSku: row.sellerSku,
          fnsku: row.fnsku,
          disposition: row.disposition,
          requestedQty: row.requestedQty,
          cancelledQty: row.cancelledQty,
          disposedQty: row.disposedQty,
          shippedQty: row.shippedQty,
          inProcessQty: row.inProcessQty,
          removalFee: row.removalFee,
          currency: row.currency,
        },
        update: {
          disposition: row.disposition,
          requestedQty: row.requestedQty,
          cancelledQty: row.cancelledQty,
          disposedQty: row.disposedQty,
          shippedQty: row.shippedQty,
          inProcessQty: row.inProcessQty,
          removalFee: row.removalFee,
          currency: row.currency,
        },
      })
    }

    totalUpserted += groupRows.length

    // Update progress every 5 orders
    if (totalUpserted % 5 === 0) {
      await prisma.importJob.update({
        where: { id: jobId },
        data: { totalFound, totalUpserted },
      })
    }
  }

  // ── 6. Finalize ────────────────────────────────────────────────────────────
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', totalFound, totalUpserted, completedAt: new Date() },
  })

  return { totalFound, totalUpserted }
}
