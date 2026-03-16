/**
 * POST /api/orders/bulk-process
 *
 * Processes multiple PENDING orders in sequence, reserving inventory for each.
 *
 * Body: {
 *   orders: Array<{
 *     orderId: string
 *     reservations: Array<{
 *       orderItemId: string
 *       productId:   string
 *       locationId:  string
 *       qtyReserved: number
 *       gradeId?:    string | null
 *     }>
 *   }>
 * }
 *
 * Returns: {
 *   results: Array<{ orderId: string; success: boolean; error?: string }>
 *   succeeded: number
 *   failed: number
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

interface ReservationInput {
  orderItemId: string
  productId:   string
  locationId:  string
  qtyReserved: number
  gradeId?:    string | null
}

interface OrderInput {
  orderId:      string
  reservations: ReservationInput[]
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { orders } = body as { orders?: OrderInput[] }
  if (!Array.isArray(orders) || orders.length === 0) {
    return NextResponse.json({ error: 'No orders provided' }, { status: 400 })
  }

  const results: { orderId: string; success: boolean; error?: string }[] = []

  for (const { orderId, reservations } of orders) {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: { select: { id: true, gradeId: true } } },
      })
      if (!order) { results.push({ orderId, success: false, error: 'Order not found' }); continue }
      if (order.workflowStatus !== 'PENDING') {
        results.push({ orderId, success: false, error: `Order status is ${order.workflowStatus}, expected PENDING` })
        continue
      }
      if (!Array.isArray(reservations) || reservations.length === 0) {
        results.push({ orderId, success: false, error: 'No reservations provided' }); continue
      }

      // Enforce order item's gradeId as source of truth (prevents stale frontend data)
      const itemGradeMap = new Map(order.items.map(i => [i.id, i.gradeId ?? null]))
      for (const r of reservations) {
        const authoritative = itemGradeMap.get(r.orderItemId)
        if (authoritative !== undefined) r.gradeId = authoritative
      }

      // Validate all reservation inputs
      let validationError: string | null = null
      for (const r of reservations) {
        if (!r.orderItemId || !r.productId || !r.locationId || r.qtyReserved < 1) {
          validationError = 'Invalid reservation data'; break
        }
        const gradeId = r.gradeId ?? null
        const inv = gradeId
          ? await prisma.inventoryItem.findUnique({
              where: { productId_locationId_gradeId: { productId: r.productId, locationId: r.locationId, gradeId } },
            })
          : await prisma.inventoryItem.findFirst({
              where: { productId: r.productId, locationId: r.locationId, gradeId: null },
            })
        if (!inv || inv.qty < r.qtyReserved) {
          validationError = `Insufficient stock at selected location for item (available: ${inv?.qty ?? 0})`
          break
        }
      }
      if (validationError) { results.push({ orderId, success: false, error: validationError }); continue }

      // Apply reservations in a transaction
      await prisma.$transaction(async tx => {
        for (const r of reservations) {
          const gradeId = r.gradeId ?? null
          if (gradeId) {
            await tx.inventoryItem.update({
              where: { productId_locationId_gradeId: { productId: r.productId, locationId: r.locationId, gradeId } },
              data: { qty: { decrement: r.qtyReserved } },
            })
          } else {
            const inv = await tx.inventoryItem.findFirst({
              where: { productId: r.productId, locationId: r.locationId, gradeId: null },
            })
            if (!inv) throw new Error(`Inventory item not found for product ${r.productId}`)
            await tx.inventoryItem.update({
              where: { id: inv.id },
              data: { qty: { decrement: r.qtyReserved } },
            })
          }
          await tx.orderInventoryReservation.create({
            data: {
              orderId,
              orderItemId: r.orderItemId,
              productId:   r.productId,
              locationId:  r.locationId,
              gradeId:     r.gradeId ?? null,
              qtyReserved: r.qtyReserved,
            },
          })

          // Stamp the grade onto the order item so serialization enforces it
          if (r.gradeId) {
            await tx.orderItem.update({
              where: { id: r.orderItemId },
              data:  { gradeId: r.gradeId },
            })
          }
        }
        await tx.order.update({
          where: { id: orderId },
          data: { workflowStatus: 'PROCESSING', processedAt: new Date() },
        })
      })

      results.push({ orderId, success: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[bulk-process] order ${orderId}:`, message)
      results.push({ orderId, success: false, error: message })
    }
  }

  const succeeded = results.filter(r => r.success).length
  const failed    = results.filter(r => !r.success).length

  return NextResponse.json({ results, succeeded, failed })
}
