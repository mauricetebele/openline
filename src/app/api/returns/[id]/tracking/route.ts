/**
 * POST /api/returns/[id]/tracking — refresh carrier tracking status
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { getCarrierStatus } from '@/lib/ups-tracking'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const ret = await prisma.mFNReturn.findUnique({
    where: { id },
    select: { id: true, trackingNumber: true },
  })
  if (!ret) return NextResponse.json({ error: 'Return not found' }, { status: 404 })
  if (!ret.trackingNumber) {
    return NextResponse.json({ error: 'No tracking number on this return' }, { status: 400 })
  }

  try {
    const result = await getCarrierStatus(ret.trackingNumber)

    await prisma.mFNReturn.update({
      where: { id },
      data: {
        carrierStatus: result.status,
        deliveredAt: result.deliveredAt,
        estimatedDelivery: result.estimatedDelivery,
        trackingUpdatedAt: new Date(),
      },
    })

    return NextResponse.json({
      carrierStatus: result.status,
      deliveredAt: result.deliveredAt,
      estimatedDelivery: result.estimatedDelivery,
      trackingUpdatedAt: new Date(),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Tracking lookup failed'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
