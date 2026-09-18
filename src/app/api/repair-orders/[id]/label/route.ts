/**
 * POST /api/repair-orders/[id]/label
 * Create an outbound (to vendor) or inbound (back to us) multi-piece label for a
 * repair order, using the shared shipping-label engine. Stores the tracking +
 * carrier on the order.
 *
 * Body: { direction: 'outbound'|'inbound', path, serviceCode, packages, confirmation?, upsCredentialId? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { WHOLESALE_SHIP_FROM } from '@/lib/ups-tracking'
import { createManualShipment, rateManualShipment, type LabelAddress, type ManualLabelInput } from '@/lib/shipping-labels'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const OPEN_LINE: LabelAddress = {
  name: WHOLESALE_SHIP_FROM.name, company: WHOLESALE_SHIP_FROM.name,
  address1: WHOLESALE_SHIP_FROM.line1, address2: WHOLESALE_SHIP_FROM.line2,
  city: WHOLESALE_SHIP_FROM.city, state: WHOLESALE_SHIP_FROM.state, postal: WHOLESALE_SHIP_FROM.postal,
  country: WHOLESALE_SHIP_FROM.country, phone: WHOLESALE_SHIP_FROM.phone,
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.repairOrder.findUnique({ where: { id: params.id }, include: { vendor: true } })
  if (!order) return NextResponse.json({ error: 'Repair order not found' }, { status: 404 })

  const b = await req.json().catch(() => ({}))
  const direction = b?.direction === 'inbound' ? 'inbound' : 'outbound'
  const v = order.vendor
  if (!v.address1 || !v.city || !v.state || !v.postal) {
    return NextResponse.json({ error: `Vendor "${v.companyName}" has no shipping address — add one on the vendor first.` }, { status: 400 })
  }
  const vendorAddr: LabelAddress = {
    name: v.companyName, company: v.companyName, address1: v.address1, address2: v.address2 ?? undefined,
    city: v.city, state: v.state, postal: v.postal, country: v.country || 'US', phone: v.phone ?? undefined,
  }

  const input: ManualLabelInput = {
    path: b?.path === 'fedex' ? 'fedex' : b?.path === 'ss' ? 'ss' : 'ups',
    shipFrom: direction === 'outbound' ? OPEN_LINE : vendorAddr,
    shipTo: direction === 'outbound' ? vendorAddr : OPEN_LINE,
    packages: Array.isArray(b?.packages) ? b.packages : [],
    serviceCode: typeof b?.serviceCode === 'string' ? b.serviceCode : '',
    confirmation: ['none', 'delivery', 'signature', 'adult_signature'].includes(b?.confirmation) ? b.confirmation : 'none',
    referenceNumber: `RO-${order.orderNumber} ${direction}`,
    upsCredentialId: typeof b?.upsCredentialId === 'string' ? b.upsCredentialId : undefined,
  }
  if (input.packages.length === 0) return NextResponse.json({ error: 'Add at least one box' }, { status: 400 })
  if (!input.serviceCode) return NextResponse.json({ error: 'Select a service' }, { status: 400 })

  // Rate-only: quote without buying or storing anything.
  if (b?.rateOnly) {
    try {
      const rate = await rateManualShipment(input)
      return NextResponse.json(rate)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Rate failed' }, { status: 400 })
    }
  }

  let result
  try {
    result = await createManualShipment(input)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Label creation failed' }, { status: 400 })
  }

  const trackings = result.pieces.map(p => p.trackingNumber).join(', ')
  await prisma.repairOrder.update({
    where: { id: params.id },
    data: direction === 'outbound'
      ? { outboundCarrier: result.carrier, outboundTracking: trackings, outboundShipmentId: result.masterTracking, ...(order.status === 'DRAFT' ? { status: 'SHIPPED_OUT' as const } : {}) }
      : { inboundCarrier: result.carrier, inboundTracking: trackings, inboundShipmentId: result.masterTracking, ...(order.status === 'AT_VENDOR' || order.status === 'SHIPPED_OUT' ? { status: 'RETURNED' as const } : {}) },
  })

  return NextResponse.json({ direction, ...result })
}
