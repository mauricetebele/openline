/**
 * POST /api/shipping-cost
 *
 * Multi-source waterfall for shipping label cost lookup:
 *  1. Local DB — OrderLabel.shipmentCost
 *  2. MFN getShipment — quoted rate for own-carrier labels
 *  3. Finances v2024-06-19 — listTransactions for postage/label transactions
 *  4. Finances v0 fallback — PostageBilling_Postage from AdjustmentEventList
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { SpApiClient } from '@/lib/amazon/sp-api'

// ─── Types ───────────────────────────────────────────────────────────────────

type LabelType = 'amazon_rate' | 'linked_carrier' | 'unknown'
type Confidence = 'high' | 'medium' | 'low'

interface TransactionCandidate {
  transactionId: string | null
  type: string | null
  description: string | null
  amount: number
  currency: string
  postedDate: string | null
}

interface ShippingCostResponse {
  orderId: string | null
  shipmentId: string | null
  labelType: LabelType
  carrier: string | null
  service: string | null
  tracking: string | null
  purchaseQuotedCost: number | null
  amazonTransactionAmount: number | null
  carrierBilledAmount: number | null
  bestEstimate: number | null
  confidence: Confidence
  reason: string
  candidates: TransactionCandidate[]
  warnings: string[]
  raw: {
    mfnShipment: Record<string, unknown> | null
    transactions: unknown[] | null
    v0Events: Record<string, unknown> | null
    dbLabel: Record<string, unknown> | null
  }
}

// ─── Finances v0 types ──────────────────────────────────────────────────────

interface AdjustmentEvent {
  AdjustmentType: string
  PostedDate?: string
  AdjustmentAmount?: { CurrencyAmount: number; CurrencyCode: string }
  AdjustmentItemList?: {
    SellerSKU?: string
    TotalAmount?: { CurrencyAmount: number; CurrencyCode: string }
    PerUnitAmount?: { CurrencyAmount: number; CurrencyCode: string }
  }[]
}

interface FinancialEventsPayload {
  payload: {
    FinancialEvents: {
      AdjustmentEventList?: AdjustmentEvent[]
      [key: string]: unknown
    }
  }
}

// ─── Finances v2024-06-19 types ─────────────────────────────────────────────

interface FinancesV2Transaction {
  sellingPartnerMetadata?: { sellingPartnerId?: string }
  transactionId?: string
  transactionType?: string
  transactionStatus?: string
  description?: string
  relatedIdentifiers?: { relatedIdentifierName: string; relatedIdentifierValue: string }[]
  totalAmount?: { currencyAmount: number; currencyCode: string }
  marketplaceDetails?: { marketplaceId?: string }
  postedDate?: string
  items?: {
    description?: string
    totalAmount?: { currencyAmount: number; currencyCode: string }
  }[]
}

interface FinancesV2Response {
  transactions?: FinancesV2Transaction[]
  nextToken?: string
}

// ─── MFN getShipment types ──────────────────────────────────────────────────

interface MfnShipmentPayload {
  payload: {
    ShipmentId: string
    AmazonOrderId: string
    Status: string
    TrackingId?: string
    ShippingService?: {
      ShippingServiceName?: string
      CarrierName?: string
      Rate?: { Amount: number; CurrencyCode: string }
    }
  }
}

// ─── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const amazonOrderId = (body.amazonOrderId as string)?.trim() || null
  const shipmentId = (body.shipmentId as string)?.trim() || null
  if (!amazonOrderId && !shipmentId) {
    return NextResponse.json({ error: 'amazonOrderId or shipmentId is required' }, { status: 400 })
  }

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) {
    return NextResponse.json({ error: 'No active Amazon account' }, { status: 400 })
  }

  const client = new SpApiClient(account.id)
  const warnings: string[] = []

  // Raw data for debug
  let rawMfnShipment: Record<string, unknown> | null = null
  let rawTransactions: unknown[] | null = null
  let rawV0Events: Record<string, unknown> | null = null
  let rawDbLabel: Record<string, unknown> | null = null

  // ─── Step A: Local DB lookup ────────────────────────────────────────────
  let dbCost: number | null = null
  let dbCarrier: string | null = null
  let dbService: string | null = null
  let dbTracking: string | null = null

  if (amazonOrderId) {
    try {
      const order = await prisma.order.findFirst({
        where: { amazonOrderId },
        include: { label: true },
      })
      if (order?.label) {
        rawDbLabel = {
          id: order.label.id,
          trackingNumber: order.label.trackingNumber,
          shipmentCost: order.label.shipmentCost?.toString() ?? null,
          carrier: order.label.carrier,
          serviceCode: order.label.serviceCode,
          createdAt: order.label.createdAt,
        }
        if (order.label.shipmentCost) {
          dbCost = Number(order.label.shipmentCost)
        }
        dbCarrier = order.label.carrier
        dbService = order.label.serviceCode
        dbTracking = order.label.trackingNumber
      }
    } catch (err) {
      console.error('[shipping-cost] DB lookup error:', err)
      warnings.push('DB lookup failed')
    }
  }

  // ─── Step B: MFN getShipment ────────────────────────────────────────────
  let mfnRate: number | null = null
  let mfnCarrier: string | null = null
  let mfnService: string | null = null
  let mfnTracking: string | null = null
  let mfnStatus: string | null = null

  if (shipmentId) {
    try {
      const resp = await client.get<MfnShipmentPayload>(
        `/mfn/v0/shipments/${shipmentId}`,
      )
      const shipment = resp.payload
      rawMfnShipment = shipment as unknown as Record<string, unknown>

      mfnCarrier = shipment?.ShippingService?.CarrierName ?? null
      mfnService = shipment?.ShippingService?.ShippingServiceName ?? null
      mfnTracking = shipment?.TrackingId ?? null
      mfnStatus = shipment?.Status ?? null

      const rate = shipment?.ShippingService?.Rate
      if (rate && rate.Amount > 0) {
        mfnRate = rate.Amount
      }
    } catch (err) {
      console.error('[shipping-cost] MFN getShipment error:', err)
      warnings.push('MFN getShipment call failed — shipment ID may be invalid')
    }
  }

  // ─── Step C: Finances v2024-06-19 listTransactions ──────────────────────
  const transactionCandidates: TransactionCandidate[] = []

  if (amazonOrderId) {
    try {
      const resp = await client.get<FinancesV2Response>(
        '/finances/2024-06-19/transactions',
        {
          relatedIdentifierName: 'ORDER_ID',
          relatedIdentifierValue: amazonOrderId,
        },
      )
      const transactions = resp.transactions ?? []
      rawTransactions = transactions as unknown as unknown[]

      for (const txn of transactions) {
        const desc = txn.description ?? ''
        const txnType = txn.transactionType ?? ''
        const isShippingRelated =
          /postage|shipping|label|buy.?shipping/i.test(desc) ||
          /postage|shipping|label/i.test(txnType)

        if (isShippingRelated || txn.totalAmount) {
          transactionCandidates.push({
            transactionId: txn.transactionId ?? null,
            type: txn.transactionType ?? null,
            description: desc || null,
            amount: Math.abs(txn.totalAmount?.currencyAmount ?? 0),
            currency: txn.totalAmount?.currencyCode ?? 'USD',
            postedDate: txn.postedDate ?? null,
          })
        }
      }
    } catch (err) {
      console.error('[shipping-cost] Finances v2024-06-19 error:', err)
      warnings.push('Finances v2024-06-19 API call failed')
    }
  }

  // ─── Step D: Finances v0 fallback ───────────────────────────────────────
  let v0PostageCost: number | null = null

  if (amazonOrderId) {
    try {
      const resp = await client.get<FinancialEventsPayload>(
        `/finances/v0/orders/${amazonOrderId}/financialEvents`,
      )
      const fe = resp.payload?.FinancialEvents ?? {}
      rawV0Events = fe as Record<string, unknown>

      for (const adj of fe.AdjustmentEventList ?? []) {
        if (adj.AdjustmentType === 'PostageBilling_Postage') {
          const amt = Math.abs(adj.AdjustmentAmount?.CurrencyAmount ?? 0)
          if (amt > 0) {
            v0PostageCost = (v0PostageCost ?? 0) + amt
          }
        }
      }
    } catch (err) {
      console.error('[shipping-cost] Finances v0 error:', err)
      warnings.push('Finances v0 API call failed')
    }
  }

  // ─── Step E: Determine label type ───────────────────────────────────────
  let labelType: LabelType = 'unknown'

  if (v0PostageCost && v0PostageCost > 0) {
    labelType = 'amazon_rate'
  } else if (mfnRate !== null || (mfnStatus !== null && !v0PostageCost)) {
    // MFN record exists but no Amazon billing → linked carrier
    labelType = 'linked_carrier'
  } else if (dbCost !== null && dbCarrier) {
    // Infer from DB carrier field
    const carrier = dbCarrier.toLowerCase()
    if (carrier.includes('amazon') || carrier.includes('amzl')) {
      labelType = 'amazon_rate'
    } else {
      labelType = 'linked_carrier'
    }
  }

  // ─── Step F: Build response ─────────────────────────────────────────────

  // Pick best carrier/service/tracking from available sources
  const carrier = mfnCarrier ?? dbCarrier ?? null
  const service = mfnService ?? dbService ?? null
  const tracking = mfnTracking ?? dbTracking ?? null

  // Determine best estimate and confidence
  let bestEstimate: number | null = null
  let confidence: Confidence = 'low'
  let reason = ''

  if (mfnRate !== null) {
    bestEstimate = mfnRate
    confidence = 'high'
    reason = `MFN getShipment returned quoted rate of $${mfnRate.toFixed(2)}`
    if (labelType === 'linked_carrier') {
      reason += '. Note: this is the Amazon-quoted rate; actual carrier billing may differ.'
      warnings.push('Linked carrier label — the quoted rate may not match the actual billed amount from your carrier.')
    }
  } else if (v0PostageCost !== null && v0PostageCost > 0) {
    bestEstimate = v0PostageCost
    confidence = 'high'
    reason = `Amazon PostageBilling_Postage charge found: $${v0PostageCost.toFixed(2)}`
  } else if (transactionCandidates.length > 0) {
    const shippingTxns = transactionCandidates.filter(c => c.amount > 0)
    if (shippingTxns.length === 1) {
      bestEstimate = shippingTxns[0].amount
      confidence = 'medium'
      reason = `Single shipping-related transaction found via Finances v2024-06-19: $${bestEstimate.toFixed(2)}`
    } else if (shippingTxns.length > 1) {
      bestEstimate = shippingTxns.reduce((sum, t) => sum + t.amount, 0)
      confidence = 'medium'
      reason = `${shippingTxns.length} shipping-related transactions found — summed total: $${bestEstimate.toFixed(2)}. Review candidates for accuracy.`
    }
  } else if (dbCost !== null && dbCost > 0) {
    bestEstimate = dbCost
    confidence = 'medium'
    reason = `Label cost from local DB: $${dbCost.toFixed(2)} — no API confirmation available`
  } else {
    bestEstimate = null
    confidence = 'low'
    reason = 'No shipping cost data found from any source'
  }

  // 48-hour warning for recent orders
  if (amazonOrderId) {
    try {
      const order = await prisma.order.findFirst({ where: { amazonOrderId } })
      if (order) {
        const hoursSincePurchase = (Date.now() - order.purchaseDate.getTime()) / (1000 * 60 * 60)
        if (hoursSincePurchase < 48) {
          warnings.push('This order is less than 48 hours old — Amazon Finances data may not be available yet.')
        }
      }
    } catch { /* ignore */ }
  }

  // Amazon transaction amount for linked carrier context
  const amazonTransactionAmount = v0PostageCost ?? (
    transactionCandidates.length > 0
      ? transactionCandidates.reduce((sum, c) => sum + c.amount, 0)
      : null
  )

  const response: ShippingCostResponse = {
    orderId: amazonOrderId,
    shipmentId,
    labelType,
    carrier,
    service,
    tracking,
    purchaseQuotedCost: mfnRate ?? dbCost,
    amazonTransactionAmount: amazonTransactionAmount && amazonTransactionAmount > 0 ? amazonTransactionAmount : null,
    carrierBilledAmount: null, // Not available through SP-API
    bestEstimate,
    confidence,
    reason,
    candidates: transactionCandidates,
    warnings,
    raw: {
      mfnShipment: rawMfnShipment,
      transactions: rawTransactions,
      v0Events: rawV0Events,
      dbLabel: rawDbLabel,
    },
  }

  return NextResponse.json(response)
}
