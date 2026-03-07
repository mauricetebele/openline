/**
 * FBA Reimbursements sync — downloads the GET_FBA_REIMBURSEMENTS_DATA
 * report from SP-API, parses the TSV, and upserts rows into fba_reimbursements.
 *
 * Amazon caps this report at ~90 days per request. For longer ranges we
 * chunk into 90-day windows and merge results.
 */
import axios from 'axios'
import { gunzip } from 'zlib'
import { promisify } from 'util'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'

const gunzipAsync = promisify(gunzip)
const MAX_CHUNK_DAYS = 90

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

interface CreateReportResponse { reportId: string }
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
  if (!raw) return null
  const n = parseFloat(raw)
  return isNaN(n) ? null : n
}

function parseInt10(raw: string): number | null {
  if (!raw) return null
  const n = parseInt(raw, 10)
  return isNaN(n) ? null : n
}

/** Request a single report, poll until done, download + decompress, return raw TSV text. */
async function fetchReportTsv(
  client: SpApiClient,
  marketplaceId: string,
  chunkStart: Date,
  chunkEnd: Date,
): Promise<string | null> {
  const { reportId } = await client.post<CreateReportResponse>('/reports/2021-06-30/reports', {
    reportType: 'GET_FBA_REIMBURSEMENTS_DATA',
    marketplaceIds: [marketplaceId],
    dataStartTime: chunkStart.toISOString(),
    dataEndTime: chunkEnd.toISOString(),
  })
  console.log(`[FBA Reimbursements] Requested report ${reportId} for ${chunkStart.toISOString()} → ${chunkEnd.toISOString()}`)

  // Poll until DONE (max 30 × 10 s = 5 min)
  let reportDocumentId: string | undefined
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(10_000)
    const report = await client.get<Record<string, unknown>>(`/reports/2021-06-30/reports/${reportId}`)
    const status = report.processingStatus as string
    console.log(`[FBA Reimbursements] Poll #${attempt + 1}: status=${status}`)
    if (status === 'DONE') {
      reportDocumentId = report.reportDocumentId as string
      break
    }
    if (status === 'FATAL' || status === 'CANCELLED') {
      console.error('[FBA Reimbursements] Report failed. Full response:', JSON.stringify(report))
      throw new Error(`FBA reimbursements report ended with status: ${status}`)
    }
  }
  if (!reportDocumentId) throw new Error('FBA reimbursements report did not complete within the polling window')

  const docMeta = await client.get<GetReportDocumentResponse>(
    `/reports/2021-06-30/documents/${reportDocumentId}`,
  )
  const response = await axios.get<ArrayBuffer>(docMeta.url, { responseType: 'arraybuffer' })
  let buffer = Buffer.from(response.data)
  if (docMeta.compressionAlgorithm === 'GZIP') buffer = await gunzipAsync(buffer)

  return buffer.toString('utf-8').replace(/^\uFEFF/, '')
}

export async function syncFbaReimbursements(
  accountId: string,
  jobId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ totalFound: number; totalUpserted: number }> {
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
  const client = new SpApiClient(accountId)

  // ── Build 90-day chunks ────────────────────────────────────────────────
  const chunks: { start: Date; end: Date }[] = []
  let cursor = new Date(startDate)
  while (cursor < endDate) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + MAX_CHUNK_DAYS * 86_400_000, endDate.getTime()))
    chunks.push({ start: new Date(cursor), end: chunkEnd })
    cursor = chunkEnd
  }
  console.log(`[FBA Reimbursements] ${chunks.length} chunk(s) for ${startDate.toISOString()} → ${endDate.toISOString()}`)

  let totalFound = 0
  let totalUpserted = 0

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]
    const tsvText = await fetchReportTsv(client, account.marketplaceId, chunk.start, chunk.end)
    if (!tsvText) continue

    const lines = tsvText.split('\n')
    const headers = lines[0]?.split('\t').map((h) => h.trim().toLowerCase()) ?? []

    const rows = lines
      .slice(1)
      .filter((line) => line.trim())
      .map((line) => line.split('\t'))

    for (const row of rows) {
      totalFound++

      const reimbursementId = col(row, headers, 'reimbursement-id', 'reimbursement id')
      if (!reimbursementId) continue

      const orderId       = col(row, headers, 'amazon-order-id', 'order-id', 'order id') || null
      const caseId        = col(row, headers, 'case-id', 'case id') || null
      const reason        = col(row, headers, 'reason', 'reimbursement reason') || null
      const sku           = col(row, headers, 'sku', 'seller-sku', 'merchant-sku') || null
      const fnsku         = col(row, headers, 'fnsku', 'fn-sku') || null
      const asin          = col(row, headers, 'asin') || null
      const title         = col(row, headers, 'product-name', 'product name', 'title', 'item name') || null
      const condition     = col(row, headers, 'condition', 'item-condition') || null
      const currencyUnit  = col(row, headers, 'currency-unit', 'currency unit', 'currency') || 'USD'
      const amountPerUnit = parseDecimal(col(row, headers, 'amount-per-unit', 'amount per unit'))
      const amountTotal   = parseDecimal(col(row, headers, 'amount-total', 'amount total'))
      const quantityReimbursedCash      = parseInt10(col(row, headers, 'quantity-reimbursed-cash', 'quantity reimbursed cash'))
      const quantityReimbursedInventory = parseInt10(col(row, headers, 'quantity-reimbursed-inventory', 'quantity reimbursed inventory'))
      const quantityReimbursedTotal     = parseInt10(col(row, headers, 'quantity-reimbursed-total', 'quantity reimbursed total'))
      const approvalDate  = parseDate(col(row, headers, 'approval-date', 'approval date'))

      const dedupSku = sku ?? ''

      await prisma.fbaReimbursement.upsert({
        where: {
          accountId_reimbursementId_sku: { accountId, reimbursementId, sku: dedupSku },
        },
        create: {
          accountId, reimbursementId, orderId, caseId, reason,
          sku: dedupSku, fnsku, asin, title, condition, currencyUnit,
          amountPerUnit, amountTotal,
          quantityReimbursedCash, quantityReimbursedInventory, quantityReimbursedTotal,
          approvalDate,
        },
        update: {
          orderId, caseId, reason, fnsku, asin, title, condition, currencyUnit,
          amountPerUnit, amountTotal,
          quantityReimbursedCash, quantityReimbursedInventory, quantityReimbursedTotal,
          approvalDate,
        },
      })
      totalUpserted++

      if (totalUpserted % 20 === 0) {
        await prisma.importJob.update({
          where: { id: jobId },
          data: { totalFound, totalUpserted },
        })
      }
    }

    console.log(`[FBA Reimbursements] Chunk ${ci + 1}/${chunks.length} done: ${rows.length} rows`)
  }

  // ── Finalize ───────────────────────────────────────────────────────────
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', totalFound, totalUpserted, completedAt: new Date() },
  })

  return { totalFound, totalUpserted }
}
