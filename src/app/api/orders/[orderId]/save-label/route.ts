/**
 * POST /api/orders/[orderId]/save-label
 * Persists a purchased shipping label and advances order → AWAITING_VERIFICATION.
 * Only called for real (non-test) label purchases.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

interface SaveLabelBody {
  trackingNumber: string
  labelData:      string   // base64
  labelFormat:    string
  shipmentCost?:  number
  carrier?:       string
  serviceCode?:   string
  ssShipmentId?:  number   // ShipStation shipmentId — enables label voiding
}

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findUnique({ where: { id: params.orderId } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.workflowStatus !== 'PROCESSING') {
    return NextResponse.json({ error: 'Order is not in the Unshipped state' }, { status: 409 })
  }

  const body: SaveLabelBody = await req.json()
  if (!body.trackingNumber || !body.labelData) {
    return NextResponse.json({ error: 'trackingNumber and labelData are required' }, { status: 400 })
  }

  await prisma.$transaction([
    prisma.orderLabel.upsert({
      where:  { orderId: params.orderId },
      create: {
        orderId:        params.orderId,
        trackingNumber: body.trackingNumber,
        labelData:      body.labelData,
        labelFormat:    body.labelFormat ?? 'pdf',
        shipmentCost:   body.shipmentCost ?? null,
        carrier:        body.carrier ?? null,
        serviceCode:    body.serviceCode ?? null,
        isTest:         false,
        ssShipmentId:   body.ssShipmentId ?? null,
      },
      update: {
        trackingNumber: body.trackingNumber,
        labelData:      body.labelData,
        labelFormat:    body.labelFormat ?? 'pdf',
        shipmentCost:   body.shipmentCost ?? null,
        carrier:        body.carrier ?? null,
        serviceCode:    body.serviceCode ?? null,
        ssShipmentId:   body.ssShipmentId ?? null,
      },
    }),
    prisma.order.update({
      where: { id: params.orderId },
      data:  { workflowStatus: 'AWAITING_VERIFICATION' },
    }),
  ])

  return NextResponse.json({ success: true })
}
