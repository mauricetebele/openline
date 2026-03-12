/**
 * GET /api/inventory/events
 *
 * Returns aggregated inventory movement events, grouped into batches
 * (serial events that occurred within 1 second of each other for the same
 * product + location + event type are merged into a single row with qty = count).
 *
 * Query params:
 *   sku        — filter by product SKU (partial match)
 *   eventType  — filter by event type
 *   startDate  — ISO date string
 *   endDate    — ISO date string
 *   page       — 1-based (default 1)
 *   limit      — default 50, max 200
 *
 * When `sku` resolves to exactly one product, before/after quantities are
 * computed per (product, location) running total starting from 0.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const EVENT_LABEL: Record<string, string> = {
  PO_RECEIPT:     'PO Receipt',
  MANUAL_ADD:     'Manual Add',
  LOCATION_MOVE:  'Move',
  SKU_CONVERSION: 'SKU Convert',
  SALE:           'Sale',
  MANUAL_REMOVE:  'Manual Remove',
}

// add / remove / move
function eventDirection(eventType: string): 'add' | 'remove' | 'move' {
  if (['PO_RECEIPT', 'MANUAL_ADD'].includes(eventType)) return 'add'
  if (['SALE', 'MANUAL_REMOVE'].includes(eventType))    return 'remove'
  if (eventType === 'LOCATION_MOVE')                    return 'move'
  if (eventType === 'SKU_CONVERSION')                   return 'move'
  return 'add'
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const skuFilter       = searchParams.get('sku')?.trim() ?? ''
  const eventTypeFilter = searchParams.get('eventType')?.trim() ?? ''
  const startDate       = searchParams.get('startDate')?.trim() ?? ''
  const endDate         = searchParams.get('endDate')?.trim() ?? ''
  const page            = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit           = Math.min(200, parseInt(searchParams.get('limit') ?? '50', 10))

  // ── Build filter ────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (eventTypeFilter) where.eventType = eventTypeFilter

  if (startDate || endDate) {
    where.createdAt = {}
    if (startDate) where.createdAt.gte = new Date(startDate)
    if (endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      where.createdAt.lte = end
    }
  }

  if (skuFilter) {
    where.inventorySerial = {
      product: { sku: { contains: skuFilter, mode: 'insensitive' } },
    }
  }

  // ── Fetch raw serial history ────────────────────────────────────────────────
  const rawRows = await prisma.serialHistory.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      inventorySerial: {
        include: {
          product:  { select: { id: true, sku: true, description: true } },
          grade:    { select: { id: true, grade: true } },
        },
      },
      location:     { select: { id: true, name: true } },
      fromLocation: { select: { id: true, name: true } },
      fromProduct:  { select: { id: true, sku: true, description: true } },
      toProduct:    { select: { id: true, sku: true, description: true } },
      receipt:      { select: { id: true, receivedAt: true } },
      purchaseOrder:{ select: { id: true, poNumber: true } },
    },
  })

  // ── Group into batches ──────────────────────────────────────────────────────
  // Key: eventType|productId|locationKey|roundedSecond
  // Each group becomes one display row with qty = count of serials

  interface Batch {
    key: string
    eventType: string
    product:   { id: string; sku: string; description: string }
    grade:     { id: string; grade: string } | null
    location:  { id: string; name: string } | null
    fromLocation: { id: string; name: string } | null
    fromProduct:  { id: string; sku: string; description: string } | null
    toProduct:    { id: string; sku: string; description: string } | null
    notes:     string | null
    poNumber:  string | null
    createdAt: Date
    serials:   string[]
    qty:       number
    beforeQty: number | null
    afterQty:  number | null
  }

  const batchMap = new Map<string, Batch>()

  for (const r of rawRows) {
    const serial    = r.inventorySerial
    const product   = serial.product
    const locId     = r.locationId   ?? 'none'
    const fromLocId = r.fromLocationId ?? 'none'
    const locKey    = `${locId}-${fromLocId}`
    const gradeId   = serial.grade?.id ?? 'none'
    const sec       = Math.floor(r.createdAt.getTime() / 1000)
    const key       = `${r.eventType}|${product.id}|${gradeId}|${locKey}|${sec}`

    if (!batchMap.has(key)) {
      batchMap.set(key, {
        key,
        eventType:    r.eventType,
        product,
        grade:        serial.grade ?? null,
        location:     r.location     ?? null,
        fromLocation: r.fromLocation ?? null,
        fromProduct:  r.fromProduct  ?? null,
        toProduct:    r.toProduct    ?? null,
        notes:        r.notes        ?? null,
        poNumber:     r.purchaseOrder?.poNumber ?? null,
        createdAt:    r.createdAt,
        serials:      [],
        qty:          0,
        beforeQty:    null,
        afterQty:     null,
      })
    }

    const batch = batchMap.get(key)!
    batch.qty++
    if (serial.serialNumber) batch.serials.push(serial.serialNumber)
    // Keep most-recent timestamp in the batch (rows are desc so first = most recent)
    if (r.createdAt > batch.createdAt) batch.createdAt = r.createdAt
  }

  // Convert to sorted array (already desc from DB)
  let batches = Array.from(batchMap.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )

  // ── Compute before/after when filtering by specific SKU ────────────────────
  // Find matching product(s)
  if (skuFilter) {
    const matchedProducts = await prisma.product.findMany({
      where: { sku: { contains: skuFilter, mode: 'insensitive' } },
      select: { id: true },
    })
    const productIds = new Set(matchedProducts.map(p => p.id))

    if (productIds.size > 0) {
      // For each (productId, locationId) pair, get current qty from InventoryItem
      const inventoryItems = await prisma.inventoryItem.findMany({
        where: { productId: { in: [...productIds] } },
        select: { productId: true, locationId: true, qty: true },
      })

      // Build running totals map: key = productId|locationId → current qty
      const qtyMap = new Map<string, number>()
      for (const item of inventoryItems) {
        const k = `${item.productId}|${item.locationId}`
        qtyMap.set(k, (qtyMap.get(k) ?? 0) + item.qty)
      }

      // Walk events newest → oldest computing before/after
      // "after" = state after the event occurred = runningQty before subtraction
      // For add events: after = running, before = running - qty
      // For remove events: after = running, before = running + qty
      // For moves (LOCATION_MOVE): need to handle src and dst separately

      // Rebuild batches in asc order for forward pass, then reverse
      const ascBatches = [...batches].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )

      // Forward pass: start from 0, accumulate qty per (product, location)
      const runMap = new Map<string, number>()

      for (const batch of ascBatches) {
        if (!productIds.has(batch.product.id)) continue
        const direction = eventDirection(batch.eventType)

        if (batch.eventType === 'LOCATION_MOVE') {
          // Remove from source
          const fromKey = `${batch.product.id}|${batch.fromLocation?.id ?? ''}`
          const fromBefore = runMap.get(fromKey) ?? 0
          runMap.set(fromKey, fromBefore - batch.qty)
          // We only annotate the batch with the primary location (destination for moves)
          const toKey = `${batch.product.id}|${batch.location?.id ?? ''}`
          const toBefore = runMap.get(toKey) ?? 0
          batch.beforeQty = toBefore
          batch.afterQty  = toBefore + batch.qty
          runMap.set(toKey, toBefore + batch.qty)
        } else if (batch.eventType === 'SKU_CONVERSION') {
          // Remove from source product — not shown here (different SKU)
          // Show as add to destination product
          const toKey = `${batch.product.id}|${batch.location?.id ?? ''}`
          const toBefore = runMap.get(toKey) ?? 0
          batch.beforeQty = toBefore
          batch.afterQty  = toBefore + batch.qty
          runMap.set(toKey, toBefore + batch.qty)
        } else if (direction === 'add') {
          const k = `${batch.product.id}|${batch.location?.id ?? ''}`
          const before = runMap.get(k) ?? 0
          batch.beforeQty = before
          batch.afterQty  = before + batch.qty
          runMap.set(k, before + batch.qty)
        } else {
          // remove
          const k = `${batch.product.id}|${batch.location?.id ?? ''}`
          const before = runMap.get(k) ?? 0
          batch.beforeQty = before
          batch.afterQty  = before - batch.qty
          runMap.set(k, before - batch.qty)
        }
      }

      batches = ascBatches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    }
  }

  const total     = batches.length
  const paginated = batches.slice((page - 1) * limit, page * limit)

  // ── Shape response ──────────────────────────────────────────────────────────
  const data = paginated.map(b => ({
    key:         b.key,
    eventType:   b.eventType,
    direction:   eventDirection(b.eventType),
    detailLabel: EVENT_LABEL[b.eventType] ?? b.eventType,
    sku:         b.product.sku,
    description: b.product.description,
    grade:       b.grade?.grade ?? null,
    qty:         b.qty,
    location:    b.location?.name ?? b.fromLocation?.name ?? null,
    fromLocation:b.fromLocation?.name ?? null,
    toLocation:  b.location?.name ?? null,
    fromSku:     b.fromProduct?.sku ?? null,
    toSku:       b.toProduct?.sku ?? null,
    notes:       b.notes,
    poNumber:    b.poNumber,
    createdAt:   b.createdAt.toISOString(),
    serials:     b.serials,
    beforeQty:   b.beforeQty,
    afterQty:    b.afterQty,
  }))

  return NextResponse.json({ data, total, page, limit })
}
