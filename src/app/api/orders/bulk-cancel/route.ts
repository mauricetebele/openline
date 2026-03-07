/**
 * POST /api/orders/bulk-cancel
 * Bulk-cancel orders in PENDING or PROCESSING status.
 * Releases inventory reservations if any, then marks CANCELLED.
 * Body: { orderIds: string[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const CANCELLABLE = new Set(['PENDING', 'PROCESSING'])

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderIds } = await req.json()
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds array required' }, { status: 400 })
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: { reservations: true },
  })

  const results: { orderId: string; success: boolean; error?: string }[] = []

  for (const order of orders) {
    if (!CANCELLABLE.has(order.workflowStatus)) {
      results.push({ orderId: order.id, success: false, error: `Cannot cancel from ${order.workflowStatus}` })
      continue
    }
    try {
      await prisma.$transaction(async tx => {
        for (const r of order.reservations) {
          await tx.inventoryItem.updateMany({
            where: { productId: r.productId, locationId: r.locationId, gradeId: r.gradeId ?? null },
            data:  { qty: { increment: r.qtyReserved } },
          })
        }
        if (order.reservations.length > 0) {
          await tx.orderInventoryReservation.deleteMany({ where: { orderId: order.id } })
        }
        await tx.order.update({
          where: { id: order.id },
          data:  { workflowStatus: 'CANCELLED', processedAt: null },
        })
      })
      results.push({ orderId: order.id, success: true })
    } catch (e) {
      results.push({ orderId: order.id, success: false, error: e instanceof Error ? e.message : 'Unknown error' })
    }
  }

  // Report any IDs that weren't found
  const foundIds = new Set(orders.map(o => o.id))
  for (const id of orderIds) {
    if (!foundIds.has(id)) {
      results.push({ orderId: id, success: false, error: 'Order not found' })
    }
  }

  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  return NextResponse.json({ results, succeeded, failed })
}
