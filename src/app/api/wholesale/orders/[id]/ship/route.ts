/**
 * POST /api/wholesale/orders/[id]/ship
 * Body: {
 *   carrier:  string
 *   tracking: string
 *   serials?: Array<{ serialNumber: string; salesOrderItemId?: string }>
 * }
 *
 * Supports two flows:
 * 1. All-at-once: serials in body → creates assignments + marks OUT_OF_STOCK + ships
 * 2. Pre-serialized: no serials in body, existing SalesOrderSerialAssignment records
 *    → marks pre-assigned serials OUT_OF_STOCK + ships
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
    serials?: { serialId?: string; serialNumber?: string; salesOrderItemId?: string }[]
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

  const hasPreAssigned = so.serialAssignments.length > 0
  const hasBodySerials = serials.length > 0
  const totalSerializable = so.items
    .filter(i => i.product?.isSerializable)
    .reduce((sum, i) => sum + Math.round(Number(i.quantity)), 0)

  if (!hasBodySerials && !hasPreAssigned && totalSerializable > 0) {
    return NextResponse.json(
      { error: 'Order has serializable items but no serial numbers were provided or pre-assigned' },
      { status: 400 },
    )
  }

  try {
    // Resolve body serials by serial number if provided (all-at-once flow)
    let resolvedBodySerials: { serialId: string; salesOrderItemId: string | null }[] = []
    if (hasBodySerials) {
      const usesNumbers = serials.some(s => s.serialNumber)
      if (usesNumbers) {
        const snList = serials.map(s => (s.serialNumber ?? '').trim()).filter(Boolean)
        const found = await prisma.inventorySerial.findMany({
          where: { serialNumber: { in: snList } },
          select: { id: true, serialNumber: true, status: true },
        })
        const snMap = new Map(found.map(s => [s.serialNumber, s]))
        const notFound = snList.filter(sn => !snMap.has(sn))
        if (notFound.length > 0) {
          return NextResponse.json({
            error: `Serial(s) not found: ${notFound.slice(0, 5).join(', ')}`,
          }, { status: 400 })
        }
        const notInStock = found.filter(s => s.status !== 'IN_STOCK')
        if (notInStock.length > 0) {
          return NextResponse.json({
            error: `Serial${notInStock.length > 1 ? 's' : ''} not IN_STOCK: ${notInStock.slice(0, 5).map(s => s.serialNumber).join(', ')}`,
          }, { status: 409 })
        }
        resolvedBodySerials = serials.map(s => {
          const sn = (s.serialNumber ?? '').trim()
          const inv = snMap.get(sn)!
          return { serialId: inv.id, salesOrderItemId: s.salesOrderItemId ?? null }
        })
      } else {
        resolvedBodySerials = serials.map(s => ({
          serialId: s.serialId!,
          salesOrderItemId: s.salesOrderItemId ?? null,
        }))
      }
    }

    // Load reservations for inventory decrement
    const reservations = await prisma.salesOrderInventoryReservation.findMany({
      where: { salesOrderId: params.id },
    })

    // Transaction: decrement inventory, mark serials, ship order
    await prisma.$transaction(async (tx) => {
      // Decrement inventory for each reservation
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

      if (hasBodySerials && resolvedBodySerials.length > 0) {
        // All-at-once flow: create assignments + mark OUT_OF_STOCK
        // Mark serials OUT_OF_STOCK by serial number (avoids ID pattern validation)
        for (const s of resolvedBodySerials) {
          await tx.inventorySerial.update({
            where: { id: s.serialId },
            data: { status: 'OUT_OF_STOCK' },
          })
        }
        await tx.salesOrderSerialAssignment.createMany({
          data: resolvedBodySerials.map(s => ({
            salesOrderId:     params.id,
            salesOrderItemId: s.salesOrderItemId,
            serialId:         s.serialId,
          })),
        })
      } else if (hasPreAssigned) {
        // Pre-serialized flow: mark pre-assigned serials as OUT_OF_STOCK
        // Use relation filter to avoid passing ID arrays to Prisma
        await tx.inventorySerial.updateMany({
          where: {
            salesOrderAssignment: { salesOrderId: params.id },
          },
          data: { status: 'OUT_OF_STOCK' },
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

    // Push updated qty to marketplaces
    const productIds = Array.from(new Set(reservations.map(r => r.productId)))
    if (productIds.length > 0) pushQtyForProducts(productIds)

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[ship] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
