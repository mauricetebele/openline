/**
 * POST /api/wholesale/orders/[id]/auto-match-serials
 * Body: { serials: string[] }
 *
 * Looks up each serial number, determines its product, and auto-matches
 * it to the correct order item. Returns matched results with validation.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { serials } = await req.json() as { serials: string[] }
  if (!Array.isArray(serials) || serials.length === 0) {
    return NextResponse.json({ error: 'serials array is required' }, { status: 400 })
  }
  if (serials.length > 500) {
    return NextResponse.json({ error: 'Too many serials (max 500)' }, { status: 400 })
  }

  const so = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: {
      items: {
        include: { product: true },
      },
      serialAssignments: true,
    },
  })
  if (!so) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Build product→orderItem mapping (with remaining qty slots)
  // An order item can accept multiple serials (qty > 1)
  const itemsByProduct = new Map<string, { orderItemId: string; sku: string; remaining: number; gradeId: string | null }[]>()
  for (const item of so.items) {
    if (!item.productId || !item.product?.isSerializable) continue
    const assignedCount = so.serialAssignments.filter(a => a.salesOrderItemId === item.id).length
    const remaining = Math.round(Number(item.quantity)) - assignedCount
    if (remaining <= 0) continue
    const arr = itemsByProduct.get(item.productId) ?? []
    arr.push({ orderItemId: item.id, sku: item.sku, remaining, gradeId: item.gradeId ?? null })
    itemsByProduct.set(item.productId, arr)
  }

  // Also resolve MSKU mappings: sellerSku → productId
  for (const item of so.items) {
    if (!item.product?.isSerializable) continue
    if (item.productId && itemsByProduct.has(item.productId)) continue // already mapped
    const msku = await prisma.productGradeMarketplaceSku.findFirst({
      where: { sellerSku: item.sku },
      select: { productId: true, gradeId: true },
    })
    if (msku) {
      const assignedCount = so.serialAssignments.filter(a => a.salesOrderItemId === item.id).length
      const remaining = Math.round(Number(item.quantity)) - assignedCount
      if (remaining > 0) {
        const arr = itemsByProduct.get(msku.productId) ?? []
        arr.push({ orderItemId: item.id, sku: item.sku, remaining, gradeId: msku.gradeId ?? null })
        itemsByProduct.set(msku.productId, arr)
      }
    }
  }

  // Fetch all serials in one query
  const snList = serials.map(s => s.trim()).filter(Boolean)
  const allSerials = await prisma.inventorySerial.findMany({
    where: { serialNumber: { in: snList, mode: 'insensitive' } },
    include: {
      product: { select: { id: true, sku: true, description: true } },
      location: { include: { warehouse: true } },
      grade: { select: { id: true, grade: true } },
      orderAssignments: { include: { order: { select: { workflowStatus: true } } } },
      salesOrderAssignment: { include: { salesOrder: { select: { fulfillmentStatus: true, id: true } } } },
    },
  })
  const serialMap = new Map(allSerials.map(s => [s.serialNumber.toLowerCase(), s]))

  // Track consumed slots per order item
  const consumedSlots = new Map<string, number>()

  const results: Record<string, {
    valid: boolean
    serialId?: string
    orderItemId?: string
    sku?: string
    location?: string
    reason?: string
    detail?: string
  }> = {}

  for (const sn of snList) {
    const serial = serialMap.get(sn.toLowerCase())

    if (!serial) {
      results[sn] = { valid: false, reason: 'NOT_FOUND', detail: `Serial "${sn}" not found in inventory` }
      continue
    }

    // Not in stock
    if (serial.status !== 'IN_STOCK') {
      results[sn] = { valid: false, reason: 'NOT_IN_STOCK', detail: `Serial "${sn}" is ${serial.status}` }
      continue
    }

    // Already assigned to active Amazon order
    const activeAssignment = serial.orderAssignments.some(a =>
      !['SHIPPED', 'CANCELLED'].includes(a.order.workflowStatus)
    )
    if (activeAssignment) {
      results[sn] = { valid: false, reason: 'ALREADY_ASSIGNED', detail: `Serial "${sn}" assigned to another order` }
      continue
    }

    // Already assigned to active wholesale order (excluding this one)
    if (
      serial.salesOrderAssignment &&
      !['SHIPPED', 'CANCELLED'].includes(serial.salesOrderAssignment.salesOrder.fulfillmentStatus) &&
      serial.salesOrderAssignment.salesOrder.id !== params.id
    ) {
      results[sn] = { valid: false, reason: 'ALREADY_ASSIGNED', detail: `Serial "${sn}" assigned to another wholesale order` }
      continue
    }

    // Find matching order item for this serial's product
    const candidates = itemsByProduct.get(serial.productId) ?? []
    let matched: typeof candidates[0] | null = null
    for (const c of candidates) {
      const used = consumedSlots.get(c.orderItemId) ?? 0
      if (used < c.remaining) {
        // Grade check
        if (c.gradeId && serial.gradeId !== c.gradeId) continue
        if (!c.gradeId && serial.gradeId) continue
        matched = c
        break
      }
    }

    if (!matched) {
      results[sn] = {
        valid: false,
        reason: 'NO_MATCHING_ITEM',
        detail: `Serial "${sn}" (${serial.product.sku}) doesn't match any unfilled item on this order`,
      }
      continue
    }

    // Consume a slot
    consumedSlots.set(matched.orderItemId, (consumedSlots.get(matched.orderItemId) ?? 0) + 1)

    results[sn] = {
      valid: true,
      serialId: serial.id,
      orderItemId: matched.orderItemId,
      sku: serial.product.sku,
      location: `${serial.location.warehouse.name} › ${serial.location.name}`,
    }
  }

  return NextResponse.json({ results })
}
