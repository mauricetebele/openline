/**
 * POST /api/orders/[orderId]/serialize
 * Assigns validated serial numbers to order items and advances order → SHIPPED.
 *
 * Body: {
 *   assignments: Array<{
 *     orderItemId: string       // Order.items[].id
 *     serialNumbers: string[]   // one per qty (for serializable products)
 *   }>
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

interface AssignmentInput {
  orderItemId:   string
  serialNumbers: string[]
}

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where:   { id: params.orderId },
    include: { items: true, label: { select: { trackingNumber: true, carrier: true, serviceCode: true, shipmentCost: true } } },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.workflowStatus !== 'AWAITING_VERIFICATION') {
    return NextResponse.json({ error: 'Order is not awaiting verification' }, { status: 409 })
  }

  const { assignments }: { assignments: AssignmentInput[] } = await req.json()
  if (!Array.isArray(assignments)) {
    return NextResponse.json({ error: 'assignments array is required' }, { status: 400 })
  }

  // ── Validate every serial before touching the DB ───────────────────────────
  const resolvedSerials: {
    orderItemId: string
    serialId:    string
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
        where:   { serialNumber: sn },
        include: { product: true, orderAssignment: true },
      })

      if (!serial) {
        return NextResponse.json(
          { error: `Serial "${sn}" not found in inventory` },
          { status: 422 },
        )
      }
      if (serial.productId !== product.id) {
        return NextResponse.json(
          { error: `Serial "${sn}" belongs to SKU "${serial.product.sku}", expected "${orderItem.sellerSku}"` },
          { status: 422 },
        )
      }
      if (serial.orderAssignment) {
        return NextResponse.json(
          { error: `Serial "${sn}" is already assigned to another order` },
          { status: 422 },
        )
      }
      if (serial.status !== 'IN_STOCK') {
        return NextResponse.json(
          { error: `Serial "${sn}" is not in stock (status: ${serial.status})` },
          { status: 422 },
        )
      }

      resolvedSerials.push({ orderItemId: a.orderItemId, serialId: serial.id, serialNumber: sn })
    }
  }

  // ── Build sale notes with all available context ──────────────────────────
  const label = order.label
  const noteParts = [`Amazon Order ${order.amazonOrderId}`]
  if (order.shipToName) noteParts.push(`Buyer: ${order.shipToName}`)
  if (label?.carrier) noteParts.push(`Carrier: ${label.carrier}`)
  if (label?.serviceCode) noteParts.push(`Service: ${label.serviceCode}`)
  if (label?.trackingNumber) noteParts.push(`Tracking: ${label.trackingNumber}`)
  if (label?.shipmentCost) noteParts.push(`Cost: $${Number(label.shipmentCost).toFixed(2)}`)
  const saleNotes = noteParts.join(' · ')

  // ── Apply all changes in a transaction ────────────────────────────────────
  await prisma.$transaction(async tx => {
    for (const r of resolvedSerials) {
      // Look up the serial's current location for the history record
      const serial = await tx.inventorySerial.findUnique({
        where: { id: r.serialId },
        select: { locationId: true },
      })

      // Mark serial as SOLD
      await tx.inventorySerial.update({
        where: { id: r.serialId },
        data:  { status: 'SOLD' },
      })

      // Record serial assignment
      await tx.orderSerialAssignment.create({
        data: {
          orderId:           params.orderId,
          orderItemId:       r.orderItemId,
          inventorySerialId: r.serialId,
        },
      })

      // Add serial history event with full sale context
      await tx.serialHistory.create({
        data: {
          inventorySerialId: r.serialId,
          eventType:         'SALE',
          orderId:           params.orderId,
          locationId:        serial?.locationId ?? null,
          notes:             saleNotes,
        },
      })
    }

    // Advance workflow to SHIPPED
    await tx.order.update({
      where: { id: params.orderId },
      data:  { workflowStatus: 'SHIPPED' },
    })
  })

  return NextResponse.json({ success: true })
}
