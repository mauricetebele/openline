/**
 * GET /api/orders/[orderId]/label
 * Returns the saved shipping label for an order (for reprinting).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const label = await prisma.orderLabel.findUnique({ where: { orderId: params.orderId } })
  if (!label) return NextResponse.json({ error: 'No label found for this order' }, { status: 404 })

  return NextResponse.json({
    trackingNumber: label.trackingNumber,
    labelData:      label.labelData,
    labelFormat:    label.labelFormat,
    carrier:        label.carrier,
    serviceCode:    label.serviceCode,
    shipmentCost:   label.shipmentCost,
    isTest:         label.isTest,
    createdAt:      label.createdAt,
  })
}
