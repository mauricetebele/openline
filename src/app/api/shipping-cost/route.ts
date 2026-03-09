/**
 * POST /api/shipping-cost
 *
 * Look up Amazon financial events for an order to find shipping costs
 * charged when purchasing labels via Amazon Buy Shipping.
 *
 * Two sources of shipping cost data:
 *  1. AdjustmentEventList → "PostageBilling_Postage"  (Amazon-vendor labels)
 *  2. ShipmentEventList → ItemFeeList / ItemChargeList (own-carrier-account labels)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { SpApiClient } from '@/lib/amazon/sp-api'
import type { SpApiCurrencyAmount } from '@/types'

// ─── Adjustment events (Amazon-vendor labels) ────────────────────────────────

interface AdjustmentEvent {
  AdjustmentType: string
  PostedDate?: string
  AdjustmentAmount?: SpApiCurrencyAmount
  AdjustmentItemList?: {
    AdjustmentItemId?: string
    SellerSKU?: string
    QuantityAdjusted?: number
    PerUnitAmount?: SpApiCurrencyAmount
    TotalAmount?: SpApiCurrencyAmount
  }[]
}

// ─── Shipment events (own-carrier labels) ────────────────────────────────────

interface ChargeComponent {
  ChargeType: string
  ChargeAmount: SpApiCurrencyAmount
}

interface FeeComponent {
  FeeType: string
  FeeAmount: SpApiCurrencyAmount
}

interface ShipmentItem {
  SellerSKU?: string
  OrderItemId?: string
  QuantityShipped?: number
  ItemChargeList?: ChargeComponent[]
  ItemFeeList?: FeeComponent[]
}

interface ShipmentEvent {
  AmazonOrderId: string
  PostedDate?: string
  ShipmentItemList?: ShipmentItem[]
}

// ─── Payload ─────────────────────────────────────────────────────────────────

interface FinancialEventsPayload {
  payload: {
    FinancialEvents: {
      AdjustmentEventList?: AdjustmentEvent[]
      ShipmentEventList?: ShipmentEvent[]
      [key: string]: unknown
    }
  }
}

// ─── Shipping-related fee/charge types ───────────────────────────────────────

const SHIPPING_CHARGE_TYPES = new Set([
  'ShippingCharge',
  'ShippingTax',
  'ShippingDiscount',
])

const SHIPPING_FEE_TYPES = new Set([
  'ShippingChargeback',
  'ShippingHB',
  'FBAPerUnitFulfillmentFee',
  'FBAWeightBasedFee',
  'FBAPerOrderFulfillmentFee',
])

// ─── Parsing ─────────────────────────────────────────────────────────────────

interface CostEntry {
  source: 'adjustment' | 'shipment'
  label: string
  postedDate: string | null
  amount: number
  currency: string
  details: { type: string; amount: number }[]
}

function parseFinancialEvents(
  adjustments: AdjustmentEvent[],
  shipments: ShipmentEvent[],
) {
  const entries: CostEntry[] = []

  // 1. PostageBilling from adjustments (Amazon-vendor labels)
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

  // 2. Shipping charges/fees from shipment events (own-carrier labels)
  for (const event of shipments) {
    for (const item of event.ShipmentItemList ?? []) {
      const allCharges = (item.ItemChargeList ?? []).map(c => ({
        type: c.ChargeType,
        amount: c.ChargeAmount.CurrencyAmount,
        currency: c.ChargeAmount.CurrencyCode,
        isShipping: SHIPPING_CHARGE_TYPES.has(c.ChargeType),
      }))

      const allFees = (item.ItemFeeList ?? []).map(f => ({
        type: f.FeeType,
        amount: f.FeeAmount.CurrencyAmount,
        currency: f.FeeAmount.CurrencyCode,
        isShipping: SHIPPING_FEE_TYPES.has(f.FeeType),
      }))

      // Collect shipping-specific entries
      const shippingDetails = [
        ...allCharges.filter(c => c.isShipping).map(c => ({ type: c.type, amount: c.amount })),
        ...allFees.filter(f => f.isShipping).map(f => ({ type: f.type, amount: f.amount })),
      ]

      const shippingAmount = shippingDetails.reduce((sum, d) => sum + Math.abs(d.amount), 0)

      if (shippingAmount > 0) {
        entries.push({
          source: 'shipment',
          label: `Shipment — SKU: ${item.SellerSKU ?? '—'}`,
          postedDate: event.PostedDate ?? null,
          amount: shippingAmount,
          currency: allCharges[0]?.currency ?? allFees[0]?.currency ?? 'USD',
          details: shippingDetails,
        })
      }

      // Also include ALL charges and fees for visibility
      if (shippingAmount === 0 && (allCharges.length > 0 || allFees.length > 0)) {
        entries.push({
          source: 'shipment',
          label: `Shipment — SKU: ${item.SellerSKU ?? '—'} (all fees)`,
          postedDate: event.PostedDate ?? null,
          amount: 0,
          currency: allCharges[0]?.currency ?? allFees[0]?.currency ?? 'USD',
          details: [
            ...allCharges.map(c => ({ type: `Charge: ${c.type}`, amount: c.amount })),
            ...allFees.map(f => ({ type: `Fee: ${f.type}`, amount: f.amount })),
          ],
        })
      }
    }
  }

  return {
    entries,
    totalShippingCost: entries.reduce((sum, e) => sum + e.amount, 0),
  }
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const amazonOrderId = (body.amazonOrderId as string)?.trim()
  if (!amazonOrderId) {
    return NextResponse.json({ error: 'amazonOrderId is required' }, { status: 400 })
  }

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) {
    return NextResponse.json({ error: 'No active Amazon account' }, { status: 400 })
  }

  try {
    const client = new SpApiClient(account.id)
    const resp = await client.get<FinancialEventsPayload>(
      `/finances/v0/orders/${amazonOrderId}/financialEvents`,
    )

    const fe = resp.payload?.FinancialEvents ?? {}
    const parsed = parseFinancialEvents(
      fe.AdjustmentEventList ?? [],
      fe.ShipmentEventList ?? [],
    )

    // Summary of all event types for debugging
    const eventSummary: Record<string, number> = {}
    for (const [key, val] of Object.entries(fe)) {
      if (Array.isArray(val)) eventSummary[key] = val.length
    }

    return NextResponse.json({
      amazonOrderId,
      parsed,
      eventSummary,
      raw: fe,
    })
  } catch (err) {
    console.error('[shipping-cost] Error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
