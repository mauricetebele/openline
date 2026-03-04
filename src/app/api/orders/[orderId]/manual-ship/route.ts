/**
 * POST /api/orders/[orderId]/manual-ship
 *
 * Manually mark an order as shipped with carrier + tracking info.
 * Assigns serial numbers (marks them SOLD) and advances workflow → SHIPPED.
 * LOCAL ONLY — does NOT push shipment details to any marketplace.
 *
 * Body: {
 *   carrier:  string
 *   tracking: string
 *   assignments: Array<{
 *     orderItemId:   string
 *     serialNumbers: string[]   // one per qty (for serializable products)
 *   }>
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

interface AssignmentInput {
  orderItemId: string
  serialNumbers: string[]
}

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: { items: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Allow from any non-shipped, non-cancelled status
  if (order.workflowStatus === 'SHIPPED') {
    return NextResponse.json({ error: 'Order is already shipped' }, { status: 409 })
  }
  if (order.workflowStatus === 'CANCELLED') {
    return NextResponse.json({ error: 'Order is cancelled' }, { status: 409 })
  }

  const body = await req.json() as {
    carrier: string
    tracking: string
    assignments: AssignmentInput[]
  }
  const { carrier, tracking, assignments = [] } = body

  if (!carrier?.trim()) return NextResponse.json({ error: 'carrier is required' }, { status: 400 })
  if (!tracking?.trim()) return NextResponse.json({ error: 'tracking is required' }, { status: 400 })

  // ── Validate every serial before touching the DB ──────────────────────────
  const resolvedSerials: {
    orderItemId: string
    serialId: string
    serialNumber: string
  }[] = []

  for (const a of assignments) {
    const orderItem = order.items.find(i => i.id === a.orderItemId)
    if (!orderItem) {
      return NextResponse.json({ error: `Order item ${a.orderItemId} not found` }, { status: 400 })
    }
    if (!orderItem.sellerSku) {
      return NextResponse.json({ error: `Order item ${a.orderItemId} has no SKU` }, { status: 400 })
    }

    const product = await prisma.product.findUnique({ where: { sku: orderItem.sellerSku } })
    if (!product) {
      return NextResponse.json(
        { error: `No product found for SKU "${orderItem.sellerSku}"` },
        { status: 400 },
      )
    }

    for (const sn of a.serialNumbers) {
      const serial = await prisma.inventorySerial.findFirst({
        where: { serialNumber: sn },
        include: { product: true, orderAssignment: true },
      })

      if (!serial) {
        return NextResponse.json({ error: `Serial "${sn}" not found in inventory` }, { status: 422 })
      }
      if (serial.productId !== product.id) {
        return NextResponse.json(
          { error: `Serial "${sn}" belongs to SKU "${serial.product.sku}", expected "${orderItem.sellerSku}"` },
          { status: 422 },
        )
      }
      if (serial.orderAssignment) {
        return NextResponse.json({ error: `Serial "${sn}" is already assigned to another order` }, { status: 422 })
      }
      if (serial.status !== 'IN_STOCK') {
        return NextResponse.json({ error: `Serial "${sn}" is not in stock (status: ${serial.status})` }, { status: 422 })
      }

      resolvedSerials.push({ orderItemId: a.orderItemId, serialId: serial.id, serialNumber: sn })
    }
  }

  // ── Build sale notes ──────────────────────────────────────────────────────
  const noteParts = [`Manual Ship — ${order.orderSource === 'backmarket' ? 'BackMarket' : 'Amazon'} Order ${order.amazonOrderId}`]
  if (order.shipToName) noteParts.push(`Buyer: ${order.shipToName}`)
  noteParts.push(`Carrier: ${carrier.trim()}`)
  noteParts.push(`Tracking: ${tracking.trim()}`)
  const saleNotes = noteParts.join(' · ')

  // ── Apply all changes in a transaction ────────────────────────────────────
  await prisma.$transaction(async tx => {
    for (const r of resolvedSerials) {
      const serial = await tx.inventorySerial.findUnique({
        where: { id: r.serialId },
        select: { locationId: true },
      })

      await tx.inventorySerial.update({
        where: { id: r.serialId },
        data: { status: 'SOLD' },
      })

      await tx.orderSerialAssignment.create({
        data: {
          orderId: params.orderId,
          orderItemId: r.orderItemId,
          inventorySerialId: r.serialId,
        },
      })

      await tx.serialHistory.create({
        data: {
          inventorySerialId: r.serialId,
          eventType: 'SALE',
          orderId: params.orderId,
          locationId: serial?.locationId ?? null,
          notes: saleNotes,
        },
      })
    }

    // For BackMarket orders: also save serials as bmSerials on each OrderItem
    if (order.orderSource === 'backmarket') {
      const serialsByItem = new Map<string, string[]>()
      for (const r of resolvedSerials) {
        const arr = serialsByItem.get(r.orderItemId) ?? []
        arr.push(r.serialNumber)
        serialsByItem.set(r.orderItemId, arr)
      }
      for (const [orderItemId, serials] of Array.from(serialsByItem.entries())) {
        await tx.orderItem.update({
          where: { id: orderItemId },
          data: { bmSerials: serials },
        })
      }
    }

    // Advance workflow to SHIPPED with carrier/tracking (local only)
    await tx.order.update({
      where: { id: params.orderId },
      data: {
        workflowStatus: 'SHIPPED',
        shipCarrier: carrier.trim(),
        shipTracking: tracking.trim(),
        shippedAt: new Date(),
      },
    })
  })

  return NextResponse.json({ success: true })
}
