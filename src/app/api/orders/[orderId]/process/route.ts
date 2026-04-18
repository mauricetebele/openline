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
  { params }: { params: { orderId: string } },
) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: { items: { select: { id: true, sellerSku: true, gradeId: true } } },
    })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.fulfillmentChannel === 'AFN') {
      return NextResponse.json({ error: 'AFN (FBA) orders are fulfilled by Amazon — cannot process locally' }, { status: 409 })
    }
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

    // Validate every order item has a SKU that maps to a real product
    for (const item of order.items) {
      if (!item.sellerSku) continue
      const product = await prisma.product.findUnique({ where: { sku: item.sellerSku }, select: { id: true } })
      if (!product) {
        const msku = await prisma.productGradeMarketplaceSku.findFirst({
          where: { sellerSku: item.sellerSku },
          select: { id: true },
        })
        if (!msku) {
          return NextResponse.json(
            { error: `SKU "${item.sellerSku}" does not match any existing product. Please update the SKU before processing.` },
            { status: 400 },
          )
        }
      }
    }

    // Enforce order item's gradeId as source of truth (prevents stale frontend data).
    // If the order item has a gradeId, use it. If the order item has no gradeId,
    // check if the SKU maps to a product via MSKU (which carries a grade). Only if
    // neither source provides a grade do we leave it null (ungraded).
    const itemGradeMap = new Map(order.items.map(i => [i.id, i.gradeId ?? null]))
    for (const r of reservations) {
      const itemGrade = itemGradeMap.get(r.orderItemId)
      if (itemGrade) {
        // Order item has explicit grade — always use it
        r.gradeId = itemGrade
      } else if (itemGradeMap.has(r.orderItemId)) {
        // Order item exists but has null gradeId — check MSKU mapping
        const item = order.items.find(i => i.id === r.orderItemId)
        if (item?.sellerSku) {
          const msku = await prisma.productGradeMarketplaceSku.findFirst({
            where: { sellerSku: item.sellerSku },
            select: { gradeId: true },
          })
          r.gradeId = msku?.gradeId ?? null
        } else {
          r.gradeId = null
        }
      }
    }

    // Validate basic inputs before entering transaction
    for (const r of reservations) {
      if (!r.orderItemId || !r.productId || !r.locationId || r.qtyReserved < 1) {
        return NextResponse.json({ error: 'Invalid reservation data' }, { status: 400 })
      }
    }

    // Validate stock + apply reservations atomically to prevent race conditions
    await prisma.$transaction(async tx => {
      for (const r of reservations) {
        const gradeId = r.gradeId ?? null

        // Check stock inside the transaction to prevent concurrent over-reservation
        const inv = gradeId
          ? await tx.inventoryItem.findUnique({
              where: { productId_locationId_gradeId: { productId: r.productId, locationId: r.locationId, gradeId } },
            })
          : await tx.inventoryItem.findFirst({
              where: { productId: r.productId, locationId: r.locationId, gradeId: null },
            })
        if (!inv || inv.qty < r.qtyReserved) {
          throw new Error(`Insufficient stock at selected location (available: ${inv?.qty ?? 0})`)
        }

        // Deduct from inventory
        await tx.inventoryItem.update({
          where: { id: inv.id },
          data: { qty: { decrement: r.qtyReserved } },
        })

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

        // Stamp the grade onto the order item so serialization enforces it
        // Also sync sellerSku if the reserved product differs (e.g. grade swap)
        const product = await tx.product.findUnique({
          where: { id: r.productId },
          select: { sku: true },
        })
        const orderItem = order.items.find(i => i.id === r.orderItemId)
        const skuChanged = product && orderItem && orderItem.sellerSku !== product.sku

        await tx.orderItem.update({
          where: { id: r.orderItemId },
          data: {
            ...(gradeId ? { gradeId } : {}),
            ...(skuChanged ? { sellerSku: product.sku } : {}),
          },
        })
      }

      // Advance workflow status
      await tx.order.update({
        where: { id: params.orderId },
        data: { workflowStatus: 'PROCESSING', processedAt: new Date() },
      })
    })

    // Push updated qty to marketplaces immediately
    pushQtyForProducts(reservations.map(r => r.productId))

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/orders/[orderId]/process]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
