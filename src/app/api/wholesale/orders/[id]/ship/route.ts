/**
 * POST /api/wholesale/orders/[id]/ship
 * Body: {
 *   carrier:  string
 *   tracking: string
 *   serials?: Array<{ serialId: string; salesOrderItemId?: string }>
 * }
 *
 * - Assigns serial numbers to the wholesale order (marks them SOLD)
 * - Records carrier + tracking
 * - Moves fulfillmentStatus PROCESSING → SHIPPED  (skips AWAITING_VERIFICATION)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    carrier: string
    tracking: string
    serials?: { serialId: string; salesOrderItemId?: string }[]
  }

  const { carrier, tracking, serials = [] } = body
  if (!carrier?.trim()) return NextResponse.json({ error: 'carrier is required' }, { status: 400 })
  if (!tracking?.trim()) return NextResponse.json({ error: 'tracking is required' }, { status: 400 })

  const so = await prisma.salesOrder.findUnique({ where: { id: params.id } })
  if (!so) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (so.fulfillmentStatus !== 'PROCESSING') {
    return NextResponse.json(
      { error: `Order is ${so.fulfillmentStatus} — must be PROCESSING to ship` },
      { status: 409 },
    )
  }

  // Validate serials exist and are IN_STOCK
  if (serials.length > 0) {
    const serialIds = serials.map(s => s.serialId)
    const found = await prisma.inventorySerial.findMany({
      where: { id: { in: serialIds } },
      select: { id: true, status: true, serialNumber: true },
    })
    if (found.length !== serialIds.length) {
      return NextResponse.json({ error: 'One or more serial IDs not found' }, { status: 400 })
    }
    const notInStock = found.filter(s => s.status !== 'IN_STOCK')
    if (notInStock.length > 0) {
      return NextResponse.json({
        error: `Serial${notInStock.length > 1 ? 's' : ''} not IN_STOCK: ${notInStock.map(s => s.serialNumber).join(', ')}`,
      }, { status: 409 })
    }
  }

  // Transaction: assign serials + update order
  await prisma.$transaction(async (tx) => {
    // Mark serials as SOLD and create assignment records
    for (const s of serials) {
      await tx.inventorySerial.update({
        where: { id: s.serialId },
        data: { status: 'SOLD' },
      })
      await tx.salesOrderSerialAssignment.create({
        data: {
          salesOrderId:    params.id,
          salesOrderItemId: s.salesOrderItemId ?? null,
          serialId:        s.serialId,
        },
      })
    }

    // Ship the order
    await tx.salesOrder.update({
      where: { id: params.id },
      data: {
        fulfillmentStatus: 'SHIPPED',
        shipCarrier:  carrier.trim(),
        shipTracking: tracking.trim(),
        shippedAt:    new Date(),
      },
    })
  })

  return NextResponse.json({ ok: true })
}
