/**
 * POST /api/removal-shipments/:id/no-unit  { itemId, undo? }
 * Marks one unit of a removal-shipment item as "No Unit To Receive" (a case was
 * filed but Amazon never returned the physical unit). Counts toward received.
 * Pass undo:true to decrement.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null) as { itemId?: string; undo?: boolean } | null
  const itemId = body?.itemId
  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 })

  const item = await prisma.removalShipmentItem.findFirst({
    where: { id: itemId, shipmentId: id },
    include: { _count: { select: { fbaReturnReceipts: true } } },
  })
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  let next: number
  if (body?.undo) {
    next = Math.max(0, item.noUnitToReceiveQty - 1)
  } else {
    // Can't mark more units as "no unit" than are left un-received.
    const remaining = item.quantity - item._count.fbaReturnReceipts - item.noUnitToReceiveQty
    if (remaining <= 0) {
      return NextResponse.json({ error: 'This item is already fully accounted for' }, { status: 400 })
    }
    next = item.noUnitToReceiveQty + 1
  }

  await prisma.removalShipmentItem.update({ where: { id: itemId }, data: { noUnitToReceiveQty: next } })
  return NextResponse.json({ ok: true, noUnitToReceiveQty: next })
}
