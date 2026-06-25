/**
 * FBA Removal Shipment sync — downloads the
 * GET_FBA_FULFILLMENT_REMOVAL_SHIPMENT_DETAIL_DATA report from SP-API,
 * parses the TSV, and upserts rows into removal_shipments / removal_shipment_items.
 *
 * Actual report columns (verified from Amazon):
 *   request-date | order-id | shipment-date | sku | fnsku | disposition |
 *   shipped-quantity | carrier | tracking-number | removal-order-type
 *
 * Rows are grouped by tracking-number → one RemovalShipment per tracking #.
 * Each SKU line becomes a RemovalShipmentItem with shipped quantity.
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

interface ParsedRow {
  removalOrderId: string
  trackingNumber: string
  carrier: string | null
  orderType: string | null
  shipDate: Date | null
  requestDate: Date | null
  sellerSku: string
  fnsku: string
  disposition: string | null
  quantity: number
}

export async function syncRemovalShipments(
  accountId: string,
  jobId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ totalFound: number; totalUpserted: number }> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)

  const reportType = 'GET_FBA_FULFILLMENT_REMOVAL_SHIPMENT_DETAIL_DATA'

  // ── 1. Request a fresh report for the requested date range ────────────────
  let reportDocumentId: string | undefined

  const { reportId } = await client.post<CreateReportResponse>('/reports/2021-06-30/reports', {
    reportType,
    marketplaceIds: [account.marketplaceId],
    dataStartTime: startDate.toISOString(),
    dataEndTime: endDate.toISOString(),
  })

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(10_000)
    const report = await client.get<GetReportResponse>(`/reports/2021-06-30/reports/${reportId}`)
    if (report.processingStatus === 'DONE') {
      reportDocumentId = report.reportDocumentId
      break
    }
    if (report.processingStatus === 'FATAL' || report.processingStatus === 'CANCELLED') {
      throw new Error(`Removal shipment report ended with status: ${report.processingStatus}`)
    }
  }
  if (!reportDocumentId) throw new Error('Removal shipment report did not complete within the polling window')

  // ── 3. Download ────────────────────────────────────────────────────────────
  const docMeta = await client.get<GetReportDocumentResponse>(
    `/reports/2021-06-30/documents/${reportDocumentId}`,
  )
  const response = await axios.get<ArrayBuffer>(docMeta.url, { responseType: 'arraybuffer' })
  let buffer = Buffer.from(response.data)
  if (docMeta.compressionAlgorithm === 'GZIP') buffer = await gunzipAsync(buffer)

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
    const trackingNumber = col(row, headers, 'tracking-number', 'tracking number', 'trackingnumber')
    if (!trackingNumber) continue

    const qtyRaw = col(row, headers, 'shipped-quantity', 'shipped quantity', 'quantity', 'qty')
    const quantity = Math.max(1, parseInt(qtyRaw, 10) || 1)

    parsed.push({
      removalOrderId: col(row, headers, 'order-id', 'order id', 'orderid') || '',
      trackingNumber,
      carrier:     col(row, headers, 'carrier', 'carrier-name') || null,
      orderType:   col(row, headers, 'removal-order-type', 'removal order type', 'order-type') || null,
      shipDate:    parseDate(col(row, headers, 'shipment-date', 'shipment date', 'ship-date')),
      requestDate: parseDate(col(row, headers, 'request-date', 'request date')),
      sellerSku:   col(row, headers, 'sku', 'seller-sku') || '',
      fnsku:       col(row, headers, 'fnsku', 'fn-sku') || '',
      disposition: col(row, headers, 'disposition') || null,
      quantity,
    })
  }

  // ── 5. Group by tracking-number and upsert ────────────────────────────────
  const groups = new Map<string, ParsedRow[]>()
  for (const row of parsed) {
    if (!groups.has(row.trackingNumber)) groups.set(row.trackingNumber, [])
    groups.get(row.trackingNumber)!.push(row)
  }

  let totalFound = parsed.length
  let totalUpserted = 0

  const groupEntries = Array.from(groups.values())
  for (const groupRows of groupEntries) {
    const first = groupRows[0]

    // Upsert the shipment (keyed by tracking number)
    const shipment = await prisma.removalShipment.upsert({
      where: {
        accountId_trackingNumber: {
          accountId,
          trackingNumber: first.trackingNumber,
        },
      },
      create: {
        accountId,
        removalOrderId: first.removalOrderId,
        trackingNumber: first.trackingNumber,
        carrier: first.carrier,
        orderType: first.orderType,
        shipDate: first.shipDate,
        requestDate: first.requestDate,
      },
      update: {
        removalOrderId: first.removalOrderId,
        carrier: first.carrier,
        orderType: first.orderType,
        shipDate: first.shipDate,
        requestDate: first.requestDate,
      },
    })

    // Delete existing items and re-create (idempotent on re-sync)
    await prisma.removalShipmentItem.deleteMany({
      where: { shipmentId: shipment.id },
    })

    // Create item rows — one per report row (each row = 1 shipped unit line)
    const itemData = groupRows.map(row => ({
      shipmentId: shipment.id,
      sellerSku: row.sellerSku,
      fnsku: row.fnsku,
      disposition: row.disposition,
      quantity: row.quantity,
    }))

    if (itemData.length > 0) {
      await prisma.removalShipmentItem.createMany({ data: itemData })
    }

    totalUpserted += groupRows.length

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
