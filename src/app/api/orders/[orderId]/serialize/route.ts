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
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from '@/lib/backmarket/client'

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
  if (order.workflowStatus !== 'AWAITING_VERIFICATION' && order.workflowStatus !== 'PROCESSING') {
    return NextResponse.json({ error: 'Order must be in PROCESSING or AWAITING_VERIFICATION status' }, { status: 409 })
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
    alreadyAssigned: boolean
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
        where:   { serialNumber: { equals: sn, mode: 'insensitive' } },
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
      if (serial.orderAssignment && serial.orderAssignment.orderId !== params.orderId) {
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

      const alreadyAssigned = serial.orderAssignment?.orderId === params.orderId
      resolvedSerials.push({ orderItemId: a.orderItemId, serialId: serial.id, serialNumber: sn, alreadyAssigned })
    }
  }

  // ── Build sale notes with all available context ──────────────────────────
  const label = order.label
  const isBM = order.orderSource === 'backmarket'
  const noteParts = [isBM ? `BackMarket Order ${order.amazonOrderId}` : `Amazon Order ${order.amazonOrderId}`]
  if (order.shipToName) noteParts.push(`Buyer: ${order.shipToName}`)
  if (label?.carrier) noteParts.push(`Carrier: ${label.carrier}`)
  if (label?.serviceCode) noteParts.push(`Service: ${label.serviceCode}`)
  if (label?.trackingNumber) noteParts.push(`Tracking: ${label.trackingNumber}`)
  if (label?.shipmentCost) noteParts.push(`Cost: $${Number(label.shipmentCost).toFixed(2)}`)
  const saleNotes = noteParts.join(' · ')

  // ── Group serials by orderItemId for bmSerials update ──────────────────
  const serialsByItem = new Map<string, string[]>()
  for (const r of resolvedSerials) {
    const arr = serialsByItem.get(r.orderItemId) ?? []
    arr.push(r.serialNumber)
    serialsByItem.set(r.orderItemId, arr)
  }

  // ── Apply all changes in a transaction ────────────────────────────────────
  const isShipping = order.workflowStatus === 'AWAITING_VERIFICATION'

  await prisma.$transaction(async tx => {
    for (const r of resolvedSerials) {
      const serial = await tx.inventorySerial.findUnique({
        where: { id: r.serialId },
        select: { locationId: true },
      })

      // Only mark SOLD when actually shipping; otherwise stays IN_STOCK
      if (isShipping) {
        await tx.inventorySerial.update({
          where: { id: r.serialId },
          data:  { status: 'SOLD' },
        })
      }

      // Skip creating assignment if serial is already assigned to this order
      if (!r.alreadyAssigned) {
        await tx.orderSerialAssignment.create({
          data: {
            orderId:           params.orderId,
            orderItemId:       r.orderItemId,
            inventorySerialId: r.serialId,
          },
        })
      }

      await tx.serialHistory.create({
        data: {
          inventorySerialId: r.serialId,
          eventType:         isShipping ? 'SALE' : 'ASSIGNED',
          orderId:           params.orderId,
          locationId:        serial?.locationId ?? null,
          notes:             isShipping ? saleNotes : `Assigned to order ${order.amazonOrderId}`,
        },
      })
    }

    if (isBM) {
      for (const [orderItemId, serials] of Array.from(serialsByItem.entries())) {
        await tx.orderItem.update({
          where: { id: orderItemId },
          data:  { bmSerials: serials },
        })
      }
    }

    if (isShipping) {
      await tx.order.update({
        where: { id: params.orderId },
        data:  { workflowStatus: 'SHIPPED' },
      })
    }
  })

  // ── BackMarket: push tracking + IMEI to BackMarket API (non-blocking) ──
  // Only push when actually shipping (from AWAITING_VERIFICATION)
  if (isBM && label?.trackingNumber && order.workflowStatus === 'AWAITING_VERIFICATION') {
    shipToBackMarket(order.amazonOrderId, order.items, label, serialsByItem).catch(err => {
      console.error('[serialize] BackMarket ship failed (non-blocking):', err)
    })
  }

  return NextResponse.json({ success: true })
}

/** Map ShipStation carrier codes to clean names BackMarket recognizes */
const CARRIER_NAME_MAP: Record<string, string> = {
  stamps_com: 'USPS', usps: 'USPS', ups: 'UPS', ups_walleted: 'UPS',
  fedex: 'FedEx', dhl_express: 'DHL', dhl_ecommerce: 'DHL', ontrac: 'OnTrac',
}

async function shipToBackMarket(
  bmOrderId: string,
  items: { id: string; sellerSku: string | null }[],
  label: { trackingNumber: string; carrier: string | null },
  serialsByItem: Map<string, string[]>,
) {
  const credential = await prisma.backMarketCredential.findFirst({
    where: { isActive: true },
    select: { apiKeyEnc: true },
  })
  if (!credential) {
    console.warn('[serialize] No BM credentials — skipping BackMarket ship')
    return
  }

  const client = new BackMarketClient(decrypt(credential.apiKeyEnc))
  const shipper = label.carrier
    ? (CARRIER_NAME_MAP[label.carrier.toLowerCase()] ?? label.carrier)
    : undefined

  for (const item of items) {
    if (!item.sellerSku) continue
    const imei = (serialsByItem.get(item.id) ?? []).join(',')

    console.log('[serialize→bm-ship] order=%s sku=%s tracking=%s shipper=%s imei=%s',
      bmOrderId, item.sellerSku, label.trackingNumber, shipper, imei)

    await client.post(`/orders/${bmOrderId}`, {
      order_id:        bmOrderId,
      new_state:       3,
      sku:             item.sellerSku,
      tracking_number: label.trackingNumber,
      ...(shipper ? { shipper } : {}),
      imei,
    })
  }
}
