/**
 * POST /api/wholesale/orders/[id]/ship
 * Body: {
 *   carrier:  string
 *   tracking: string
 *   serials?: Array<{ serialId: string; salesOrderItemId?: string }>
 * }
 *
 * Supports two flows:
 * 1. All-at-once: serials in body → creates assignments + marks SOLD + ships
 * 2. Pre-serialized: no serials in body, existing SalesOrderSerialAssignment records
 *    → marks pre-assigned serials SOLD + ships
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { pushQtyForProducts } from '@/lib/push-qty-for-product'

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

  const so = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: {
      items: { select: { id: true, quantity: true, product: { select: { isSerializable: true } } } },
      serialAssignments: { select: { id: true, serialId: true, salesOrderItemId: true } },
    },
  })
  if (!so) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (so.fulfillmentStatus !== 'PROCESSING') {
    return NextResponse.json(
      { error: `Order is ${so.fulfillmentStatus} — must be PROCESSING to ship` },
      { status: 409 },
    )
  }

  // Determine which serials to use
  const hasPreAssigned = so.serialAssignments.length > 0
  const hasBodySerials = serials.length > 0
  const totalSerializable = so.items
    .filter(i => i.product?.isSerializable)
    .reduce((sum, i) => sum + Math.round(Number(i.quantity)), 0)

  // If no serials provided and no pre-assigned, but items need serials → 400
  if (!hasBodySerials && !hasPreAssigned && totalSerializable > 0) {
    return NextResponse.json(
      { error: 'Order has serializable items but no serial numbers were provided or pre-assigned' },
      { status: 400 },
    )
  }

  // Validate body serials if provided (all-at-once flow)
  if (hasBodySerials) {
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

  // For pre-serialized flow, validate the pre-assigned serials are still IN_STOCK
  if (!hasBodySerials && hasPreAssigned) {
    const preSerialIds = so.serialAssignments.map(sa => sa.serialId)
    const found = await prisma.inventorySerial.findMany({
      where: { id: { in: preSerialIds } },
      select: { id: true, status: true, serialNumber: true },
    })
    const notInStock = found.filter(s => s.status !== 'IN_STOCK')
    if (notInStock.length > 0) {
      return NextResponse.json({
        error: `Pre-assigned serial${notInStock.length > 1 ? 's' : ''} no longer IN_STOCK: ${notInStock.map(s => s.serialNumber).join(', ')}`,
      }, { status: 409 })
    }
  }

  // Load reservations so we can decrement inventory on ship
  const reservations = await prisma.salesOrderInventoryReservation.findMany({
    where: { salesOrderId: params.id },
  })

  // Transaction: decrement inventory, assign serials, update order
  await prisma.$transaction(async (tx) => {
    // Decrement inventory for each reservation (qty was soft-reserved until now)
    for (const r of reservations) {
      if (r.gradeId) {
        await tx.inventoryItem.update({
          where: { productId_locationId_gradeId: { productId: r.productId, locationId: r.locationId, gradeId: r.gradeId } },
          data: { qty: { decrement: r.qtyReserved } },
        })
      } else {
        const inv = await tx.inventoryItem.findFirst({
          where: { productId: r.productId, locationId: r.locationId, gradeId: null },
        })
        if (inv) {
          await tx.inventoryItem.update({
            where: { id: inv.id },
            data: { qty: { decrement: r.qtyReserved } },
          })
        }
      }
    }

    if (hasBodySerials) {
      // All-at-once flow: create assignments + mark SOLD
      for (const s of serials) {
        await tx.inventorySerial.update({
          where: { id: s.serialId },
          data: { status: 'OUT_OF_STOCK' },
        })
        await tx.salesOrderSerialAssignment.create({
          data: {
            salesOrderId:    params.id,
            salesOrderItemId: s.salesOrderItemId ?? null,
            serialId:        s.serialId,
          },
        })
      }
    } else if (hasPreAssigned) {
      // Pre-serialized flow: just mark pre-assigned serials as SOLD
      for (const sa of so.serialAssignments) {
        await tx.inventorySerial.update({
          where: { id: sa.serialId },
          data: { status: 'OUT_OF_STOCK' },
        })
      }
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

  // Push updated qty to marketplaces (qty was decremented on ship)
  const productIds = Array.from(new Set(reservations.map(r => r.productId)))
  if (productIds.length > 0) pushQtyForProducts(productIds)

  return NextResponse.json({ ok: true })
}
