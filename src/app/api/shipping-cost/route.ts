/**
 * POST /api/shipping-cost
 *
 * Look up Amazon financial events for an order to find shipping costs
 * charged when purchasing labels via Amazon Buy Shipping.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { SpApiClient } from '@/lib/amazon/sp-api'
import type {
  SpApiChargeComponent,
  SpApiFeeComponent,
  SpApiCurrencyAmount,
} from '@/types'

interface ShipmentItem {
  SellerSKU?: string
  OrderItemId?: string
  QuantityShipped?: number
  ItemChargeList?: SpApiChargeComponent[]
  ItemFeeList?: SpApiFeeComponent[]
  PromotionList?: { PromotionType: string; PromotionId: string; PromotionAmount: SpApiCurrencyAmount }[]
}

interface ShipmentEvent {
  AmazonOrderId: string
  SellerOrderId?: string
  MarketplaceName?: string
  PostedDate?: string
  ShipmentItemList?: ShipmentItem[]
}

interface FinancialEventsPayload {
  payload: {
    FinancialEvents: {
      ShipmentEventList?: ShipmentEvent[]
      RefundEventList?: unknown[]
      [key: string]: unknown
    }
  }
}

/** Fee types that relate to shipping costs */
const SHIPPING_FEE_TYPES = new Set([
  'ShippingCharge',
  'ShippingTax',
  'ShippingDiscount',
  'ShippingHB',
  'FBAPerUnitFulfillmentFee',
  'FBAWeightBasedFee',
  'FBAPerOrderFulfillmentFee',
  'LabelingFee',
])

function parseShippingCosts(events: ShipmentEvent[]) {
  const items: {
    sku: string | null
    orderItemId: string | null
    qty: number
    charges: { type: string; amount: number; currency: string }[]
    fees: { type: string; amount: number; currency: string }[]
    shippingTotal: number
  }[] = []

  for (const event of events) {
    for (const item of event.ShipmentItemList ?? []) {
      const charges = (item.ItemChargeList ?? []).map(c => ({
        type: c.ChargeType,
        amount: c.ChargeAmount.CurrencyAmount,
        currency: c.ChargeAmount.CurrencyCode,
      }))

      const fees = (item.ItemFeeList ?? []).map(f => ({
        type: f.FeeType,
        amount: f.FeeAmount.CurrencyAmount,
        currency: f.FeeAmount.CurrencyCode,
      }))

      // Sum shipping-related charges and fees
      const shippingCharges = charges
        .filter(c => SHIPPING_FEE_TYPES.has(c.type))
        .reduce((sum, c) => sum + c.amount, 0)

      const shippingFees = fees
        .filter(f => SHIPPING_FEE_TYPES.has(f.type))
        .reduce((sum, f) => sum + f.amount, 0)

      items.push({
        sku: item.SellerSKU ?? null,
        orderItemId: item.OrderItemId ?? null,
        qty: item.QuantityShipped ?? 1,
        charges,
        fees,
        shippingTotal: Math.abs(shippingCharges) + Math.abs(shippingFees),
      })
    }
  }

  return {
    items,
    totalShippingCost: items.reduce((sum, i) => sum + i.shippingTotal, 0),
  }
}

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
    const resp = await client.get<FinancialEventsPayload['payload']>(
      `/finances/v0/orders/${amazonOrderId}/financialEvents`,
    )

    const financialEvents = resp.FinancialEvents ?? {}
    const shipmentEvents = financialEvents.ShipmentEventList ?? []
    const parsed = parseShippingCosts(shipmentEvents)

    return NextResponse.json({
      amazonOrderId,
      parsed,
      raw: financialEvents,
    })
  } catch (err) {
    console.error('[shipping-cost] Error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
