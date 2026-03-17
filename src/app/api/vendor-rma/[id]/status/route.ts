import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

const TRANSITIONS: Record<string, string> = {
  AWAITING_VENDOR_APPROVAL: 'APPROVED_TO_RETURN',
  APPROVED_TO_RETURN:       'SHIPPED_AWAITING_CREDIT',
  SHIPPED_AWAITING_CREDIT:  'CREDIT_RECEIVED',
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { newStatus, vendorApprovalNumber, carrier, trackingNumber } = body

  const rma = await prisma.vendorRMA.findUnique({
    where: { id: params.id },
    include: { items: { include: { serials: true } } },
  })
  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (TRANSITIONS[rma.status] !== newStatus) {
    return NextResponse.json({ error: 'Invalid status transition' }, { status: 400 })
  }

  if (newStatus === 'APPROVED_TO_RETURN' && !vendorApprovalNumber?.trim()) {
    return NextResponse.json({ error: 'Vendor RMA approval number is required' }, { status: 400 })
  }
  if (newStatus === 'SHIPPED_AWAITING_CREDIT') {
    if (!carrier?.trim()) return NextResponse.json({ error: 'Carrier is required' }, { status: 400 })
    if (!trackingNumber?.trim()) return NextResponse.json({ error: 'Tracking number is required' }, { status: 400 })

    // All serials must be scanned out before shipping
    const allSerials = rma.items.flatMap(i => i.serials)
    const unscanned = allSerials.filter(s => !s.scannedOutAt)
    if (allSerials.length > 0 && unscanned.length > 0) {
      return NextResponse.json(
        { error: `All serials must be scanned out before marking as shipped (${unscanned.length} of ${allSerials.length} not scanned)` },
        { status: 400 },
      )
    }
  }

  const updated = await prisma.vendorRMA.update({
    where: { id: params.id },
    data: {
      status: newStatus,
      ...(vendorApprovalNumber && { vendorApprovalNumber: vendorApprovalNumber.trim() }),
      ...(carrier && { carrier: carrier.trim() }),
      ...(trackingNumber && { trackingNumber: trackingNumber.trim() }),
    },
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          product: { select: { id: true, sku: true, description: true, isSerializable: true } },
          serials: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  })

  return NextResponse.json(updated)
}
