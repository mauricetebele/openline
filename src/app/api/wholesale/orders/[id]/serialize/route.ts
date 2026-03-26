/**
 * POST /api/wholesale/orders/[id]/serialize
 * Body: { serials: [{ serialId: string; salesOrderItemId: string }] }
 *
 * Creates SalesOrderSerialAssignment records for the order.
 * Serials stay IN_STOCK — inventory is only decremented on ship.
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
    serials: { serialId: string; salesOrderItemId: string }[]
  }

  const { serials } = body
  if (!serials?.length) {
    return NextResponse.json({ error: 'serials array is required' }, { status: 400 })
  }

  const so = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: { serialAssignments: true },
  })
  if (!so) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (so.fulfillmentStatus !== 'PROCESSING') {
    return NextResponse.json(
      { error: `Order is ${so.fulfillmentStatus} — must be PROCESSING to serialize` },
      { status: 409 },
    )
  }

  // Validate serial IDs exist and are IN_STOCK
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

  // Remove any existing assignments for this order first (re-serialize scenario)
  await prisma.salesOrderSerialAssignment.deleteMany({
    where: { salesOrderId: params.id },
  })

  // Create new assignment records (serials stay IN_STOCK)
  await prisma.$transaction(async (tx) => {
    for (const s of serials) {
      await tx.salesOrderSerialAssignment.create({
        data: {
          salesOrderId:     params.id,
          salesOrderItemId: s.salesOrderItemId,
          serialId:         s.serialId,
        },
      })
    }
  })

  return NextResponse.json({ ok: true, assigned: serials.length })
}
