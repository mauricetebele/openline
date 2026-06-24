/**
 * FBA Removal Shipment sync — downloads the
 * GET_FBA_FULFILLMENT_REMOVAL_SHIPMENT_DETAIL_DATA report from SP-API,
 * parses the TSV, and upserts rows into removal_shipments / removal_shipment_items.
 *
 * Report columns:
 *   request-date | order-id | shipment-date | sku | fnsku | quantity |
 *   shipment-id | tracking-number | carrier | title
 *
 * Each report row may have quantity > 1. We expand into individual
 * RemovalShipmentItem rows (1 per unit) for future receiving workflow.
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
  shipmentId: string
  trackingNumber: string
  carrier: string | null
  shipDate: Date | null
  sellerSku: string
  fnsku: string
  title: string | null
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

  // ── 1. Request the removal shipment report ─────────────────────────────────
  const { reportId } = await client.post<CreateReportResponse>('/reports/2021-06-30/reports', {
    reportType: 'GET_FBA_FULFILLMENT_REMOVAL_SHIPMENT_DETAIL_DATA',
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

  // Strip UTF-8 BOM
  const tsvText = buffer.toString('utf-8').replace(/^\uFEFF/, '')

  // ── 4. Parse TSV ───────────────────────────────────────────────────────────
  const lines = tsvText.split('\n')
  const headers = lines[0]?.split('\t').map((h) => h.trim().toLowerCase()) ?? []

  const rawRows = lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => line.split('\t'))

  // Parse into structured rows
  const parsed: ParsedRow[] = []
  for (const row of rawRows) {
    const shipmentId    = col(row, headers, 'shipment-id', 'shipment id', 'shipmentid')
    const trackingNumber = col(row, headers, 'tracking-number', 'tracking number', 'trackingnumber')
    const removalOrderId = col(row, headers, 'order-id', 'order id', 'orderid')
    if (!shipmentId || !trackingNumber) continue

    const qtyRaw  = col(row, headers, 'shipped-quantity', 'quantity', 'shipped quantity', 'qty')
    const quantity = Math.max(1, parseInt(qtyRaw, 10) || 1)

    parsed.push({
      removalOrderId,
      shipmentId,
      trackingNumber,
      carrier:   col(row, headers, 'carrier', 'carrier-name') || null,
      shipDate:  parseDate(col(row, headers, 'shipment-date', 'shipment date', 'ship-date')),
      sellerSku: col(row, headers, 'sku', 'seller-sku', 'merchant-sku', 'merchant sku') || '',
      fnsku:     col(row, headers, 'fnsku', 'fn-sku') || '',
      title:     col(row, headers, 'product-name', 'product name', 'title', 'item-name') || null,
      quantity,
    })
  }

  // ── 5. Group by (shipmentId, trackingNumber) and upsert ────────────────────
  const groupKey = (r: ParsedRow) => `${r.shipmentId}|${r.trackingNumber}`
  const groups = new Map<string, ParsedRow[]>()
  for (const row of parsed) {
    const key = groupKey(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  let totalFound = parsed.length
  let totalUpserted = 0

  const groupEntries = Array.from(groups.values())
  for (const groupRows of groupEntries) {
    const first = groupRows[0]

    // Upsert the shipment
    const shipment = await prisma.removalShipment.upsert({
      where: {
        accountId_shipmentId_trackingNumber: {
          accountId,
          shipmentId: first.shipmentId,
          trackingNumber: first.trackingNumber,
        },
      },
      create: {
        accountId,
        removalOrderId: first.removalOrderId,
        shipmentId: first.shipmentId,
        trackingNumber: first.trackingNumber,
        carrier: first.carrier,
        shipDate: first.shipDate,
      },
      update: {
        removalOrderId: first.removalOrderId,
        carrier: first.carrier,
        shipDate: first.shipDate,
      },
    })

    // Delete existing items and re-create (idempotent on re-sync)
    await prisma.removalShipmentItem.deleteMany({
      where: { shipmentId: shipment.id },
    })

    // Expand each row's quantity into individual item rows
    const itemData: { shipmentId: string; sellerSku: string; fnsku: string; title: string | null }[] = []
    for (const row of groupRows) {
      for (let i = 0; i < row.quantity; i++) {
        itemData.push({
          shipmentId: shipment.id,
          sellerSku: row.sellerSku,
          fnsku: row.fnsku,
          title: row.title,
        })
      }
    }

    if (itemData.length > 0) {
      await prisma.removalShipmentItem.createMany({ data: itemData })
    }

    totalUpserted += groupRows.length

    // Update progress every 5 shipments
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
