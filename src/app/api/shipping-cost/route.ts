/**
 * POST /api/shipping-cost
 *
 * Look up Amazon financial events for an order to find shipping costs
 * charged when purchasing labels via Amazon Buy Shipping.
 *
 * The label cost lives in AdjustmentEventList with
 * AdjustmentType "PostageBilling_Postage".
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { SpApiClient } from '@/lib/amazon/sp-api'
import type { SpApiCurrencyAmount } from '@/types'

interface AdjustmentItem {
  AdjustmentItemId?: string
  SellerSKU?: string
  QuantityAdjusted?: number
  PerUnitAmount?: SpApiCurrencyAmount
  TotalAmount?: SpApiCurrencyAmount
}

interface AdjustmentEvent {
  AdjustmentType: string
  PostedDate?: string
  AdjustmentAmount?: SpApiCurrencyAmount
  AdjustmentItemList?: AdjustmentItem[]
}

interface FinancialEventsPayload {
  payload: {
    FinancialEvents: {
      AdjustmentEventList?: AdjustmentEvent[]
      [key: string]: unknown
    }
  }
}

function parsePostageCost(events: AdjustmentEvent[]) {
  const postageEvents = events.filter(e => e.AdjustmentType === 'PostageBilling_Postage')

  const entries = postageEvents.map(e => ({
    type: e.AdjustmentType,
    postedDate: e.PostedDate ?? null,
    amount: Math.abs(e.AdjustmentAmount?.CurrencyAmount ?? 0),
    currency: e.AdjustmentAmount?.CurrencyCode ?? 'USD',
    items: (e.AdjustmentItemList ?? []).map(i => ({
      sku: i.SellerSKU ?? null,
      qty: i.QuantityAdjusted ?? 0,
      perUnit: i.PerUnitAmount?.CurrencyAmount ?? null,
      total: i.TotalAmount?.CurrencyAmount ?? null,
    })),
  }))

  return {
    entries,
    totalPostage: entries.reduce((sum, e) => sum + e.amount, 0),
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
    const resp = await client.get<FinancialEventsPayload>(
      `/finances/v0/orders/${amazonOrderId}/financialEvents`,
    )

    const financialEvents = resp.payload?.FinancialEvents ?? {}
    const adjustmentEvents = financialEvents.AdjustmentEventList ?? []
    const parsed = parsePostageCost(adjustmentEvents)

    // Summary of all event types for debugging
    const eventSummary: Record<string, number> = {}
    for (const [key, val] of Object.entries(financialEvents)) {
      if (Array.isArray(val)) eventSummary[key] = val.length
    }

    return NextResponse.json({
      amazonOrderId,
      parsed,
      eventSummary,
      raw: financialEvents,
    })
  } catch (err) {
    console.error('[shipping-cost] Error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
