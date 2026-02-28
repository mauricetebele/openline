import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { getCarrierStatus } from '@/lib/ups-tracking'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ret = await prisma.mFNReturn.findUnique({ where: { id: params.id } })
  if (!ret) return NextResponse.json({ error: 'Return not found' }, { status: 404 })

  if (!ret.trackingNumber) {
    return NextResponse.json({ error: 'No tracking number on this return' }, { status: 400 })
  }

  let result: Awaited<ReturnType<typeof getCarrierStatus>>
  try {
    result = await getCarrierStatus(ret.trackingNumber)
  } catch (e: unknown) {
    // Return the descriptive error to the UI — do NOT persist a failure to the DB
    const message = e instanceof Error ? e.message : 'Unable to fetch tracking status'
    return NextResponse.json({ error: message }, { status: 422 })
  }

  const { status, deliveredAt, estimatedDelivery } = result
  const trackingUpdatedAt = new Date()

  // Only persist on success
  await prisma.mFNReturn.update({
    where: { id: params.id },
    data: { carrierStatus: status, deliveredAt, estimatedDelivery, trackingUpdatedAt },
  })

  return NextResponse.json({ carrierStatus: status, deliveredAt, estimatedDelivery, trackingUpdatedAt })
}
