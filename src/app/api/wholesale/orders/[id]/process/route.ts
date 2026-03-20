/**
 * POST /api/wholesale/orders/[id]/process
 * Reserves inventory for each sales order item and advances fulfillmentStatus → PROCESSING.
 *
 * Body: {
 *   reservations: Array<{
 *     orderItemId: string   // SalesOrderItem.id
 *     productId:   string
 *     locationId:  string
 *     qtyReserved: number
 *     gradeId?:    string | null
 *   }>
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { pushQtyForProducts } from '@/lib/push-qty-for-product'

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
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const so = await prisma.salesOrder.findUnique({ where: { id: params.id } })
  if (!so) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (so.fulfillmentStatus !== 'PENDING') {
    return NextResponse.json(
      { error: `Order is ${so.fulfillmentStatus} — can only process PENDING orders` },
      { status: 409 },
    )
  }

  const { reservations }: { reservations: ReservationInput[] } = await req.json()
  if (!Array.isArray(reservations) || reservations.length === 0) {
    return NextResponse.json({ error: 'No reservations provided' }, { status: 400 })
  }

  // Validate all inputs before touching inventory
  for (const r of reservations) {
    if (!r.orderItemId || !r.productId || !r.locationId || r.qtyReserved < 1) {
      return NextResponse.json({ error: 'Invalid reservation data' }, { status: 400 })
    }
    const gradeId = r.gradeId ?? null
    // Prisma's composite-unique rejects null, so handle null gradeId separately
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

  // Apply reservations in a transaction (soft reserve — qty is NOT decremented until shipped)
  await prisma.$transaction(async tx => {
    for (const r of reservations) {
      const gradeId = r.gradeId ?? null

      // Record the reservation (no qty decrement — stays as on-hand until shipped)
      await tx.salesOrderInventoryReservation.create({
        data: {
          salesOrderId:     params.id,
          salesOrderItemId: r.orderItemId,
          productId:        r.productId,
          locationId:       r.locationId,
          gradeId,
          qtyReserved:      r.qtyReserved,
        },
      })
    }

    // Advance fulfillment status
    await tx.salesOrder.update({
      where: { id: params.id },
      data: { fulfillmentStatus: 'PROCESSING', processedAt: new Date() },
    })
  })

  // Push updated qty to marketplaces immediately
  pushQtyForProducts(reservations.map(r => r.productId))

  return NextResponse.json({ success: true })
}
