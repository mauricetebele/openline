/**
 * MFN Returns sync — downloads the GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE
 * report from SP-API, parses the TSV, and upserts rows into mfn_returns.
 *
 * Same request→poll→download→parse pattern as fba-returns.ts.
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

/** Normalize a header: lowercase + collapse all separators (spaces, hyphens, underscores) to a single space */
function norm(s: string): string {
  return s.toLowerCase().replace(/[-_\s]+/g, ' ').trim()
}

/** Try several possible column header spellings. Returns '' when not found. */
function col(row: string[], headers: string[], ...names: string[]): string {
  for (const name of names) {
    const target = norm(name)
    const idx = headers.findIndex((h) => norm(h) === target)
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

export async function syncMfnReturns(
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
      throw new Error(`MFN returns report ended with status: ${report.processingStatus}`)
    }
  }
  if (!reportDocumentId) throw new Error('MFN returns report did not complete within the polling window')

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

  // Log headers + first data row for debugging column mapping
  console.log('[MFN Returns] TSV headers:', JSON.stringify(headers))
  if (lines.length > 1) {
    const firstRow = lines[1]?.split('\t')
    const sample: Record<string, string> = {}
    headers.forEach((h, i) => { sample[h] = firstRow?.[i]?.trim() ?? '' })
    console.log('[MFN Returns] Sample row:', JSON.stringify(sample))
  }

  const rows = lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => line.split('\t'))

  let totalFound = 0
  let totalUpserted = 0

  for (const row of rows) {
    totalFound++

    const orderId = col(row, headers, 'order_id', 'order id', 'order-id', 'orderid')
    if (!orderId) continue

    const orderDate           = parseDate(col(row, headers, 'order_date', 'order-date', 'order date'))
    const rmaId               = col(row, headers, 'amazon_rma_id', 'amazon-rma-id', 'rma-id', 'rma id') || null
    const trackingNumber      = col(row, headers, 'tracking_id', 'tracking-id', 'tracking id') || null
    const returnValueRaw      = col(row, headers, 'refund_amount', 'return-value', 'item-price')
    const returnValue         = parseDecimal(returnValueRaw)
    const currency            = col(row, headers, 'currency_code', 'currency-code', 'currency') || 'USD'
    const returnDate          = parseDate(col(row, headers, 'return_request_date', 'return-request-date', 'return-date', 'return date'))
    const asin                = col(row, headers, 'asin') || null
    const sku                 = col(row, headers, 'merchant_sku', 'merchant-sku', 'sku', 'seller-sku') || null
    const title               = col(row, headers, 'item_name', 'item-name', 'product-name', 'product name', 'title') || null
    const qtyRaw              = col(row, headers, 'return_quantity', 'return-quantity', 'quantity', 'qty')
    const quantity            = qtyRaw ? (parseInt(qtyRaw, 10) || null) : null
    const returnReason        = col(row, headers, 'return_reason_code', 'return-reason-code', 'return-reason', 'return reason') || null
    const returnStatus        = col(row, headers, 'return_request_status', 'return-request-status', 'return-status', 'status') || null
    const resolution          = col(row, headers, 'resolution', 'return-resolution') || null
    const inPolicy            = col(row, headers, 'in_policy', 'in-policy', 'in policy') || null
    const isPrime             = col(row, headers, 'is_prime', 'is-prime', 'is prime') || null
    const aToZClaim           = col(row, headers, 'a_to_z_claim', 'a-to-z-claim', 'a-to-z guarantee claim') || null
    const returnType          = col(row, headers, 'return_type', 'return-type', 'return type') || null
    const labelType           = col(row, headers, 'label_type', 'label-type', 'label type') || null
    const labelCostRaw        = col(row, headers, 'label_cost', 'label-cost', 'label cost')
    const labelCost           = parseDecimal(labelCostRaw)
    const labelPaidBy         = col(row, headers, 'label_to_be_paid_by', 'label-paid-by', 'cost-of-label-paid-by') || null
    const returnCarrier       = col(row, headers, 'return_carrier', 'return-carrier', 'carrier') || null
    const merchantRmaId       = col(row, headers, 'merchant_rma_id', 'merchant-rma-id', 'merchant rma id') || null
    const returnDeliveryDate  = parseDate(col(row, headers, 'return_delivery_date', 'return-delivery-date', 'return delivery date'))
    const orderAmountRaw      = col(row, headers, 'order_amount', 'order-amount', 'order amount')
    const orderAmount         = parseDecimal(orderAmountRaw)
    const orderQtyRaw         = col(row, headers, 'order_quantity', 'order-quantity', 'order quantity')
    const orderQuantity       = orderQtyRaw ? (parseInt(orderQtyRaw, 10) || null) : null
    const refundedAmountRaw   = col(row, headers, 'refund_amount', 'refunded-amount', 'refunded amount')
    const refundedAmount      = parseDecimal(refundedAmountRaw)
    const safetClaimId        = col(row, headers, 'safet_claim_id', 'safet-claim-id', 'safet claim id') || null
    const safetClaimState     = col(row, headers, 'safet_claim_state', 'safet-claim-state', 'safet claim state') || null
    const safetActionReason   = col(row, headers, 'safet_action_reason', 'safet-action-reason', 'safet action reason') || null
    const safetClaimCreatedAt = parseDate(col(row, headers, 'safet_claim_creation_date', 'safet-claim-creation-date', 'safet claim creation date'))
    const safetReimbursementRaw = col(row, headers, 'safet_reimbursement_amount', 'safet-reimbursement-amount', 'safet reimbursement amount')
    const safetReimbursement  = parseDecimal(safetReimbursementRaw)
    const invoiceNumber       = col(row, headers, 'invoice_number', 'invoice-number', 'invoice number') || null
    const orderItemId         = col(row, headers, 'order_item_id', 'order-item-id', 'order item id') || null

    // Find existing row by accountId + orderId + rmaId (or orderId + asin if no RMA)
    const existing = await prisma.mFNReturn.findFirst({
      where: rmaId
        ? { accountId, orderId, rmaId }
        : { accountId, orderId, asin: asin ?? undefined },
      select: { id: true },
    })

    const data = {
      orderDate, rmaId, trackingNumber, returnValue, currency, returnDate,
      asin, sku, title, quantity, returnReason, returnStatus, resolution,
      inPolicy, isPrime, aToZClaim, returnType, labelType, labelCost,
      labelPaidBy, returnCarrier, merchantRmaId, returnDeliveryDate,
      orderAmount, orderQuantity, refundedAmount,
      safetClaimId, safetClaimState, safetActionReason, safetClaimCreatedAt,
      safetReimbursement, invoiceNumber, orderItemId,
    }

    if (existing) {
      await prisma.mFNReturn.update({ where: { id: existing.id }, data })
    } else {
      await prisma.mFNReturn.create({ data: { accountId, orderId, ...data } })
    }
    totalUpserted++

    // Update progress every 20 rows
    if (totalUpserted % 20 === 0) {
      await prisma.mFNReturnSyncJob.update({
        where: { id: jobId },
        data: { totalFound, totalUpserted },
      })
    }
  }

  // ── 5. Finalize ────────────────────────────────────────────────────────────
  await prisma.mFNReturnSyncJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', totalFound, totalUpserted, completedAt: new Date() },
  })

  return { totalFound, totalUpserted }
}
