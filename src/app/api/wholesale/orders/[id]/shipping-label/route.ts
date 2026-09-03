/**
 * GET  /api/wholesale/orders/[id]/shipping-label  — labels already made for this order
 * POST /api/wholesale/orders/[id]/shipping-label  — generate a UPS outbound label
 *
 * Mirrors the outbound-label flow (ship FROM our warehouse RETURN_ADDRESS, TO the
 * customer address in the request) but keyed to a wholesale SalesOrder. The
 * request's shipFrom* fields carry the DESTINATION (customer) address — the same
 * naming the shared UPS lib and /api/outbound-label use. Rating reuses
 * /api/outbound-label/rate (no side effects there).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { generateOutboundLabel, UPS_SERVICES, ReturnLabelRequest } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const labels = await prisma.returnLabel.findMany({
    where: { salesOrderId: params.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, trackingNumber: true, serviceLabel: true, serviceCode: true,
      weightValue: true, weightUnit: true, shipmentCost: true, currency: true,
      voided: true, createdAt: true,
    },
  })
  return NextResponse.json({ labels })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as ReturnLabelRequest & { upsCredentialId?: string }

  if (!body.shipFromName?.trim() || !body.shipFromAddress1?.trim() ||
      !body.shipFromCity?.trim() || !body.shipFromState?.trim() || !body.shipFromPostal?.trim()) {
    return NextResponse.json({ error: 'Ship-to address fields are required' }, { status: 400 })
  }
  if (!body.serviceCode) return NextResponse.json({ error: 'Service code is required' }, { status: 400 })
  if (!body.weightValue || body.weightValue <= 0) return NextResponse.json({ error: 'Weight is required' }, { status: 400 })

  const order = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    select: { id: true, orderNumber: true, fulfillmentStatus: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  try {
    const result = await generateOutboundLabel(
      { ...body, referenceNumber: body.referenceNumber || order.orderNumber },
      body.upsCredentialId,
    )

    const serviceLabel = UPS_SERVICES.find(s => s.code === body.serviceCode)?.label ?? body.serviceCode
    const cost = result.shipmentCost ? parseFloat(result.shipmentCost) : null

    const saved = await prisma.returnLabel.create({
      data: {
        salesOrderId:     order.id,
        shipFromName:     body.shipFromName,
        shipFromAddress1: body.shipFromAddress1,
        shipFromCity:     body.shipFromCity,
        shipFromState:    body.shipFromState,
        shipFromPostal:   body.shipFromPostal,
        shipFromCountry:  body.shipFromCountry || 'US',
        serviceCode:      body.serviceCode,
        serviceLabel,
        weightValue:      body.weightValue,
        weightUnit:       body.weightUnit,
        trackingNumber:   result.trackingNumber,
        shipmentId:       result.shipmentId,
        labelData:        result.labelBase64,
        shipmentCost:     cost,
        currency:         result.currency ?? 'USD',
        labelType:        'WHOLESALE',
        upsCredentialId:  body.upsCredentialId ?? null,
      },
    })

    // Record the label's tracking on the order (does NOT mark it shipped — the
    // Ship flow still finalizes that). Skip if the order is already shipped.
    if (order.fulfillmentStatus !== 'SHIPPED') {
      await prisma.salesOrder.update({
        where: { id: order.id },
        data: {
          shipCarrier: 'UPS',
          shipTracking: result.trackingNumber,
          ...(cost != null ? { actualShippingCost: cost } : {}),
        },
      }).catch(err => console.error('[WholesaleLabel] order writeback failed:', err))
    }

    return NextResponse.json({ ...result, labelId: saved.id })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Label generation failed' },
      { status: 500 },
    )
  }
}
