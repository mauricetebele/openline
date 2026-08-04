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
    shippingCost?: number
    serials?: { serialId?: string; serialNumber?: string; salesOrderItemId?: string }[]
  }

  const { carrier, tracking, shippingCost, serials = [] } = body
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

    // Units actually flipped OUT_OF_STOCK, keyed by their real product/location/
    // grade — populated inside the transaction, then used for shortfall
    // reconciliation and the marketplace qty push.
    const shippedByKey = new Map<string, { productId: string; locationId: string; gradeId: string | null; qty: number }>()
    const addShipped = (productId: string, locationId: string, gradeId: string | null) => {
      const key = `${productId}|${locationId}|${gradeId ?? ''}`
      const cur = shippedByKey.get(key)
      if (cur) cur.qty += 1
      else shippedByKey.set(key, { productId, locationId, gradeId, qty: 1 })
    }

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
        // All-at-once flow: create assignments + mark OUT_OF_STOCK + record SALE history
        for (const s of resolvedBodySerials) {
          const serial = await tx.inventorySerial.update({
            where: { id: s.serialId },
            data: { status: 'OUT_OF_STOCK' },
            select: { id: true, serialNumber: true, productId: true, locationId: true, gradeId: true },
          })
          addShipped(serial.productId, serial.locationId, serial.gradeId)
          await tx.serialHistory.create({
            data: {
              inventorySerialId: serial.id,
              eventType:         'SALE',
              locationId:        serial.locationId,
              userId:            user.dbId,
              salesOrderId:      params.id,
              notes:             `Wholesale sale — ${so.orderNumber} (${carrier.trim()} ${tracking.trim()})`,
            },
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
        // Pre-serialized flow: mark pre-assigned serials as OUT_OF_STOCK + record SALE history
        const preAssignedSerials = await tx.inventorySerial.findMany({
          where: { salesOrderAssignment: { salesOrderId: params.id } },
          select: { id: true, serialNumber: true, productId: true, locationId: true, gradeId: true, status: true },
        })
        // Only units that were still IN_STOCK count toward the shortfall.
        for (const serial of preAssignedSerials) {
          if (serial.status === 'IN_STOCK') addShipped(serial.productId, serial.locationId, serial.gradeId)
        }
        await tx.inventorySerial.updateMany({
          where: { salesOrderAssignment: { salesOrderId: params.id } },
          data: { status: 'OUT_OF_STOCK' },
        })
        for (const serial of preAssignedSerials) {
          await tx.serialHistory.create({
            data: {
              inventorySerialId: serial.id,
              eventType:         'SALE',
              salesOrderId:      params.id,
              locationId:        serial.locationId,
              userId:            user.dbId,
              notes:             `Wholesale sale — ${so.orderNumber} (${carrier.trim()} ${tracking.trim()})`,
            },
          })
        }
      }

      // ── Reconcile aggregate qty with the serials actually shipped ──────────
      // The reservation loop above decrements InventoryItem.qty from reservation
      // rows. In the normal path those reservations exactly cover the shipped
      // serials, so the shortfall below is 0 and this is a no-op. But if the order
      // shipped with scanned/pre-assigned serials that reservations didn't fully
      // cover (auto-process skipped, reserved qty < serials, or reserved at a
      // different location/grade), qty would stay too high while the serials flip
      // to OUT_OF_STOCK — leaving shipped units still counted as in stock (the
      // View-Stock phantom). Decrement the shortfall at each serial's actual
      // product/location/grade so qty always tracks the IN_STOCK serial count.
      const reservedByKey = new Map<string, number>()
      for (const r of reservations) {
        const key = `${r.productId}|${r.locationId}|${r.gradeId ?? ''}`
        reservedByKey.set(key, (reservedByKey.get(key) ?? 0) + r.qtyReserved)
      }
      for (const [key, g] of Array.from(shippedByKey)) {
        const shortfall = g.qty - (reservedByKey.get(key) ?? 0)
        if (shortfall > 0) {
          await tx.inventoryItem.updateMany({
            where: { productId: g.productId, locationId: g.locationId, gradeId: g.gradeId ?? null },
            data: { qty: { decrement: shortfall } },
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
          ...(shippingCost != null && { actualShippingCost: shippingCost }),
        },
      })
    }, { timeout: 30000 })

    // Push updated qty to marketplaces — cover every product touched, whether
    // its qty moved via a reservation or the shortfall reconciliation, so
    // listings can't keep advertising units that just shipped.
    const productIds = Array.from(new Set([
      ...reservations.map(r => r.productId),
      ...Array.from(shippedByKey.values()).map(g => g.productId),
    ]))
    if (productIds.length > 0) pushQtyForProducts(productIds)

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[ship] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
