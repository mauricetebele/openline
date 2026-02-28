/**
 * POST /api/orders/[orderId]/process
 * Reserves inventory for each order item and advances workflowStatus → PROCESSING.
 *
 * Body: {
 *   reservations: Array<{
 *     orderItemId: string   // Order.items[].id (our internal ID)
 *     productId:   string
 *     locationId:  string
 *     qtyReserved: number
 *     gradeId?:    string | null
 *   }>
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

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
    })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.workflowStatus !== 'PENDING') {
      return NextResponse.json({ error: 'Order has already been processed' }, { status: 409 })
    }

    let body: unknown
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { reservations } = body as { reservations?: ReservationInput[] }
    if (!Array.isArray(reservations) || reservations.length === 0) {
      return NextResponse.json({ error: 'No reservations provided' }, { status: 400 })
    }

    // Validate all inputs before touching inventory
    for (const r of reservations) {
      if (!r.orderItemId || !r.productId || !r.locationId || r.qtyReserved < 1) {
        return NextResponse.json({ error: 'Invalid reservation data' }, { status: 400 })
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
        return NextResponse.json(
          { error: `Insufficient stock at selected location (available: ${inv?.qty ?? 0})` },
          { status: 409 },
        )
      }
    }

    // Apply reservations in a transaction
    await prisma.$transaction(async tx => {
      for (const r of reservations) {
        const gradeId = r.gradeId ?? null

        // Deduct from inventory
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

        // Record the reservation
        await tx.orderInventoryReservation.create({
          data: {
            orderId:     params.orderId,
            orderItemId: r.orderItemId,
            productId:   r.productId,
            locationId:  r.locationId,
            gradeId,
            qtyReserved: r.qtyReserved,
          },
        })
      }

      // Advance workflow status
      await tx.order.update({
        where: { id: params.orderId },
        data: { workflowStatus: 'PROCESSING', processedAt: new Date() },
      })
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/orders/[orderId]/process]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
