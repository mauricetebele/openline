/**
 * POST /api/shipping-cost
 *
 * Look up Amazon shipping label costs via multiple SP-API sources:
 *  1. Finances API → AdjustmentEventList "PostageBilling_Postage" (Amazon-vendor labels)
 *  2. Finances API → ShipmentEventList charges/fees
 *  3. MFN API → GET /mfn/v0/shipments/{shipmentId} (own-carrier-account labels)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { SpApiClient } from '@/lib/amazon/sp-api'
import type { SpApiCurrencyAmount } from '@/types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdjustmentEvent {
  AdjustmentType: string
  PostedDate?: string
  AdjustmentAmount?: SpApiCurrencyAmount
  AdjustmentItemList?: {
    SellerSKU?: string
    TotalAmount?: SpApiCurrencyAmount
    PerUnitAmount?: SpApiCurrencyAmount
  }[]
}

interface ShipmentEvent {
  AmazonOrderId: string
  PostedDate?: string
  ShipmentItemList?: {
    SellerSKU?: string
    ItemChargeList?: { ChargeType: string; ChargeAmount: SpApiCurrencyAmount }[]
    ItemFeeList?: { FeeType: string; FeeAmount: SpApiCurrencyAmount }[]
  }[]
}

interface FinancialEventsPayload {
  payload: {
    FinancialEvents: {
      AdjustmentEventList?: AdjustmentEvent[]
      ShipmentEventList?: ShipmentEvent[]
      [key: string]: unknown
    }
  }
}

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

// ─── Cost entry shape ────────────────────────────────────────────────────────

interface CostEntry {
  source: 'adjustment' | 'shipment' | 'mfn'
  label: string
  postedDate: string | null
  amount: number
  currency: string
  details: { type: string; amount: number }[]
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

function parseFinancialEvents(
  adjustments: AdjustmentEvent[],
  shipments: ShipmentEvent[],
): CostEntry[] {
  const entries: CostEntry[] = []

  // PostageBilling from adjustments (Amazon-vendor labels)
  for (const adj of adjustments) {
    if (adj.AdjustmentType === 'PostageBilling_Postage') {
      entries.push({
        source: 'adjustment',
        label: 'Amazon Postage (PostageBilling)',
        postedDate: adj.PostedDate ?? null,
        amount: Math.abs(adj.AdjustmentAmount?.CurrencyAmount ?? 0),
        currency: adj.AdjustmentAmount?.CurrencyCode ?? 'USD',
        details: (adj.AdjustmentItemList ?? []).map(i => ({
          type: `SKU: ${i.SellerSKU ?? '—'}`,
          amount: Math.abs(i.TotalAmount?.CurrencyAmount ?? i.PerUnitAmount?.CurrencyAmount ?? 0),
        })),
      })
    }
  }

  // All charges/fees from shipment events for visibility
  for (const event of shipments) {
    for (const item of event.ShipmentItemList ?? []) {
      const charges = (item.ItemChargeList ?? []).map(c => ({
        type: `Charge: ${c.ChargeType}`,
        amount: c.ChargeAmount.CurrencyAmount,
      }))
      const fees = (item.ItemFeeList ?? []).map(f => ({
        type: `Fee: ${f.FeeType}`,
        amount: f.FeeAmount.CurrencyAmount,
      }))

      if (charges.length > 0 || fees.length > 0) {
        entries.push({
          source: 'shipment',
          label: `Shipment Fees — SKU: ${item.SellerSKU ?? '—'}`,
          postedDate: event.PostedDate ?? null,
          amount: 0, // these are order settlement fees, not label cost
          currency: 'USD',
          details: [...charges, ...fees],
        })
      }
    }
  }

  return entries
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const amazonOrderId = (body.amazonOrderId as string)?.trim()
  const shipmentId = (body.shipmentId as string)?.trim() || null
  if (!amazonOrderId && !shipmentId) {
    return NextResponse.json({ error: 'amazonOrderId or shipmentId is required' }, { status: 400 })
  }

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) {
    return NextResponse.json({ error: 'No active Amazon account' }, { status: 400 })
  }

  const client = new SpApiClient(account.id)
  const entries: CostEntry[] = []
  let eventSummary: Record<string, number> = {}
  let rawFinancialEvents: Record<string, unknown> = {}
  let rawMfnShipment: Record<string, unknown> | null = null

  // 1. Finances API (if we have an order ID)
  if (amazonOrderId) {
    try {
      const resp = await client.get<FinancialEventsPayload>(
        `/finances/v0/orders/${amazonOrderId}/financialEvents`,
      )

      const fe = resp.payload?.FinancialEvents ?? {}
      rawFinancialEvents = fe as Record<string, unknown>

      for (const [key, val] of Object.entries(fe)) {
        if (Array.isArray(val)) eventSummary[key] = val.length
      }

      entries.push(...parseFinancialEvents(
        fe.AdjustmentEventList ?? [],
        fe.ShipmentEventList ?? [],
      ))
    } catch (err) {
      console.error('[shipping-cost] Finances API error:', err)
    }
  }

  // 2. MFN getShipment (if we have a shipment ID)
  if (shipmentId) {
    try {
      const resp = await client.get<MfnShipmentPayload>(
        `/mfn/v0/shipments/${shipmentId}`,
      )

      const shipment = resp.payload
      rawMfnShipment = shipment as unknown as Record<string, unknown>
      const rate = shipment?.ShippingService?.Rate

      if (rate && rate.Amount > 0) {
        entries.push({
          source: 'mfn',
          label: `MFN Label — ${shipment.ShippingService?.CarrierName ?? ''} ${shipment.ShippingService?.ShippingServiceName ?? ''}`.trim(),
          postedDate: null,
          amount: rate.Amount,
          currency: rate.CurrencyCode ?? 'USD',
          details: [
            { type: 'Label Rate', amount: rate.Amount },
          ],
        })
      }
    } catch (err) {
      console.error('[shipping-cost] MFN getShipment error:', err)
    }
  }

  const totalShippingCost = entries.reduce((sum, e) => sum + e.amount, 0)

  return NextResponse.json({
    amazonOrderId: amazonOrderId || null,
    shipmentId,
    parsed: { entries, totalShippingCost },
    eventSummary,
    raw: {
      financialEvents: rawFinancialEvents,
      ...(rawMfnShipment ? { mfnShipment: rawMfnShipment } : {}),
    },
  })
}
