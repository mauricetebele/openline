/**
 * GET /api/repair-orders/[id]/tracking
 * Live UPS/FedEx tracking status for the outbound + inbound shipments.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { getCarrierStatus } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function status(trackingCsv: string | null) {
  if (!trackingCsv) return null
  const first = trackingCsv.split(',')[0]?.trim()
  if (!first) return null
  try {
    const r = await getCarrierStatus(first)
    return { tracking: first, ...r }
  } catch (e) {
    return { tracking: first, error: e instanceof Error ? e.message : 'lookup failed' }
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const order = await prisma.repairOrder.findUnique({
    where: { id: params.id },
    select: { outboundTracking: true, inboundTracking: true },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [outbound, inbound] = await Promise.all([status(order.outboundTracking), status(order.inboundTracking)])
  return NextResponse.json({ outbound, inbound })
}
