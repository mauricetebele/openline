/**
 * POST /api/wholesale/orders/[id]/shipping-label/recompute-cost
 *
 * Backfills the shipping cost for the most recent label set of an order when it
 * wasn't captured at generation (e.g. older FedEx labels — FedEx's ship response
 * omits cost). Re-rates the shipment (ACCOUNT rate) and persists the total on
 * the label + the order's actualShippingCost. Returns { cost, currency }.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { RETURN_ADDRESS } from '@/lib/ups-tracking'
import { loadFedExCredentials, getMultiPieceRate } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

const FEDEX_CODES = new Set([
  'FEDEX_GROUND', 'GROUND_HOME_DELIVERY', 'FEDEX_EXPRESS_SAVER', 'FEDEX_2_DAY', 'FEDEX_2_DAY_AM',
  'STANDARD_OVERNIGHT', 'PRIORITY_OVERNIGHT', 'FIRST_OVERNIGHT', 'SMART_POST',
])

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const labels = await prisma.returnLabel.findMany({
    where: { salesOrderId: params.id, voided: false },
    orderBy: { createdAt: 'desc' },
  })
  if (labels.length === 0) return NextResponse.json({ cost: null })

  // Most recent shipment set (multi-box pieces share a shipmentId).
  const latestSet = labels[0].shipmentId
  const set = latestSet ? labels.filter(l => l.shipmentId === latestSet) : [labels[0]]

  // If a cost is already stored on any piece, just surface it.
  const existing = set.find(l => l.shipmentCost != null)
  if (existing?.shipmentCost != null) {
    return NextResponse.json({ cost: Number(existing.shipmentCost), currency: existing.currency ?? 'USD' })
  }

  const primary = set[0]
  const isFedEx = FEDEX_CODES.has(primary.serviceCode) || /fedex/i.test(primary.serviceLabel ?? '')
  if (!isFedEx) return NextResponse.json({ cost: null }) // UPS cost is captured at generation

  const creds = await loadFedExCredentials()
  if (!creds) return NextResponse.json({ error: 'FedEx credentials not configured' }, { status: 400 })

  const settings = await prisma.storeSettings.findUnique({ where: { id: 'singleton' }, select: { phone: true } }).catch(() => null)
  const fromPhone = (settings?.phone?.trim() || '7325555555').replace(/[^0-9]/g, '') || '0000000000'

  let total: number, currency: string
  try {
    const rate = await getMultiPieceRate(creds, {
      shipFrom: {
        streetLines: [RETURN_ADDRESS.line1, RETURN_ADDRESS.line2].filter(Boolean) as string[],
        city: RETURN_ADDRESS.city, stateOrProvinceCode: RETURN_ADDRESS.state, postalCode: RETURN_ADDRESS.postal, countryCode: RETURN_ADDRESS.country,
        personName: RETURN_ADDRESS.name, phone: fromPhone,
      },
      shipTo: {
        streetLines: [primary.shipFromAddress1].filter(Boolean) as string[],
        city: primary.shipFromCity, stateOrProvinceCode: primary.shipFromState.slice(0, 2), postalCode: primary.shipFromPostal, countryCode: primary.shipFromCountry,
        personName: primary.shipFromName, phone: '0000000000',
      },
      packages: set.map(l => ({ weight: { value: Number(l.weightValue) || 1, units: 'LB' } })),
      serviceType: primary.serviceCode,
    })
    total = rate.total; currency = rate.currency
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Rate lookup failed' }, { status: 502 })
  }

  // Persist on the primary piece and the order.
  await prisma.returnLabel.update({ where: { id: primary.id }, data: { shipmentCost: total, currency } }).catch(() => {})
  await prisma.salesOrder.update({ where: { id: params.id }, data: { actualShippingCost: total } }).catch(() => {})

  return NextResponse.json({ cost: total, currency })
}
