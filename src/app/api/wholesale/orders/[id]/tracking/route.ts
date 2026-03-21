/**
 * GET /api/wholesale/orders/[id]/tracking
 * Returns live carrier tracking status for the order's tracking number.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { getCarrierStatus } from '@/lib/ups-tracking'
import { detectCarrier, trackingUrl } from '@/lib/tracking-utils'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    select: { shipTracking: true, shipCarrier: true },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!order.shipTracking) {
    return NextResponse.json({ error: 'No tracking number on this order' }, { status: 400 })
  }

  const carrier = detectCarrier(order.shipTracking)
  const url = trackingUrl(order.shipTracking)

  try {
    const result = await getCarrierStatus(order.shipTracking)
    return NextResponse.json({
      carrier,
      trackingNumber: order.shipTracking,
      trackingUrl: url,
      status: result.status,
      deliveredAt: result.deliveredAt?.toISOString() ?? null,
      estimatedDelivery: result.estimatedDelivery?.toISOString() ?? null,
    })
  } catch (e: unknown) {
    // If API call fails, still return the tracking URL so user can check manually
    return NextResponse.json({
      carrier,
      trackingNumber: order.shipTracking,
      trackingUrl: url,
      status: null,
      error: e instanceof Error ? e.message : 'Failed to fetch tracking status',
      deliveredAt: null,
      estimatedDelivery: null,
    })
  }
}
