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

  // ── When shipping: mark serials as RETURNED and decrement inventory ──
  if (newStatus === 'SHIPPED_AWAITING_CREDIT') {
    await prisma.$transaction(async (tx) => {
      // Update the RMA status
      await tx.vendorRMA.update({
        where: { id: params.id },
        data: {
          status: newStatus,
          carrier: carrier.trim(),
          trackingNumber: trackingNumber.trim(),
        },
      })

      const allSerials = rma.items.flatMap((item) =>
        item.serials.map((s) => ({ ...s, productId: item.productId }))
      )

      for (const s of allSerials) {
        // Find the matching inventory serial
        const invSerial = await tx.inventorySerial.findFirst({
          where: { serialNumber: s.serialNumber, productId: s.productId },
          select: { id: true, locationId: true, gradeId: true },
        })
        if (!invSerial) continue

        // Mark as RETURNED
        await tx.inventorySerial.update({
          where: { id: invSerial.id },
          data: { status: 'RETURNED' },
        })

        // Decrement inventory qty
        await tx.inventoryItem.updateMany({
          where: {
            productId: s.productId,
            locationId: invSerial.locationId,
            gradeId: invSerial.gradeId ?? null,
          },
          data: { qty: { decrement: 1 } },
        })

        // Create serial history entry
        await tx.serialHistory.create({
          data: {
            inventorySerialId: invSerial.id,
            eventType: 'VENDOR_RMA_SHIPPED',
            locationId: invSerial.locationId,
            userId: user.dbId,
            notes: `Vendor RMA ${rma.rmaNumber} shipped — ${carrier.trim()} ${trackingNumber.trim()}`,
          },
        })
      }

      // Also decrement qty for non-serializable items (no serials assigned)
      for (const item of rma.items) {
        if (item.serials.length === 0 && item.quantity > 0) {
          await tx.inventoryItem.updateMany({
            where: { productId: item.productId },
            data: { qty: { decrement: item.quantity } },
          })
        }
      }
    })
  } else {
    // Other transitions: just update the RMA
    await prisma.vendorRMA.update({
      where: { id: params.id },
      data: {
        status: newStatus,
        ...(vendorApprovalNumber && { vendorApprovalNumber: vendorApprovalNumber.trim() }),
        ...(carrier && { carrier: carrier.trim() }),
        ...(trackingNumber && { trackingNumber: trackingNumber.trim() }),
      },
    })
  }

  const updated = await prisma.vendorRMA.findUnique({
    where: { id: params.id },
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
