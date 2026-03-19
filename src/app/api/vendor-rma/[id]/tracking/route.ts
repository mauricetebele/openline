/**
 * POST /api/vendor-rma/[id]/tracking
 *
 * Refresh carrier tracking status for a vendor RMA via UPS/FedEx API.
 * Returns the latest status, delivery date, and estimated delivery.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { getCarrierStatus } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.vendorRMA.findUnique({
    where: { id: params.id },
    select: { id: true, trackingNumber: true },
  })
  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!rma.trackingNumber) {
    return NextResponse.json({ error: 'No tracking number on this RMA' }, { status: 400 })
  }

  try {
    const result = await getCarrierStatus(rma.trackingNumber)
    const now = new Date()

    await prisma.vendorRMA.update({
      where: { id: params.id },
      data: {
        carrierStatus: result.status,
        deliveredAt: result.deliveredAt,
        estimatedDelivery: result.estimatedDelivery,
        trackingUpdatedAt: now,
      },
    })

    return NextResponse.json({
      carrierStatus: result.status,
      deliveredAt: result.deliveredAt,
      estimatedDelivery: result.estimatedDelivery,
      trackingUpdatedAt: now.toISOString(),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Tracking lookup failed'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
