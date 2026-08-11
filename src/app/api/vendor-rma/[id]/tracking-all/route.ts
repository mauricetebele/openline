/**
 * POST /api/vendor-rma/[id]/tracking-all
 *
 * Refresh carrier tracking status for EVERY tracking number on a vendor RMA
 * (a multi-box return can have several). Returns one status per tracking number;
 * the primary (first) is also persisted onto the RMA for the summary fields.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { getCarrierStatus } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.vendorRMA.findUnique({
    where: { id: params.id },
    select: { id: true, trackingNumber: true, trackingNumbers: true },
  })
  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const tns = rma.trackingNumbers?.length ? rma.trackingNumbers : rma.trackingNumber ? [rma.trackingNumber] : []
  if (tns.length === 0) return NextResponse.json({ statuses: [] })

  const statuses = await Promise.all(tns.map(async (tn) => {
    try {
      const r = await getCarrierStatus(tn)
      return { trackingNumber: tn, status: r.status, deliveredAt: r.deliveredAt, estimatedDelivery: r.estimatedDelivery, error: null as string | null }
    } catch (e) {
      return { trackingNumber: tn, status: null, deliveredAt: null, estimatedDelivery: null, error: e instanceof Error ? e.message : 'Tracking lookup failed' }
    }
  }))

  // Keep the RMA's summary tracking fields fresh from the primary tracking #.
  const primary = statuses[0]
  if (primary && !primary.error) {
    await prisma.vendorRMA.update({
      where: { id: params.id },
      data: {
        carrierStatus: primary.status,
        deliveredAt: primary.deliveredAt,
        estimatedDelivery: primary.estimatedDelivery,
        trackingUpdatedAt: new Date(),
      },
    }).catch(() => { /* best-effort */ })
  }

  return NextResponse.json({ statuses })
}
