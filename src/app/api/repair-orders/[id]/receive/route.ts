/**
 * POST /api/repair-orders/[id]/receive
 * Receive repaired units back from the vendor, per serial. For each item:
 *   - record the outcome (REPAIRED / REFUSED) + optional summary
 *   - REPAIRED keeps/sets the repair cost (feeds profitability); REFUSED clears it
 *   - move the unit into the chosen destination location (from the vendor's repair
 *     location) and stamp receivedAt / receivedLocationId
 *   - write a REPAIR_RETURNED serial-history event describing the work performed
 *     (or refusal), the vendor, and the cost
 * When every item on the order is received, the order flips to COMPLETED.
 *
 * Body: {
 *   locationId: string,
 *   items: Array<{ itemId: string, status: 'REPAIRED'|'REFUSED', repairSummary?: string, repairCost?: number|null }>
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { pushQtyForProducts } from '@/lib/push-qty-for-product'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface ReceiveItem { itemId: string; status: 'REPAIRED' | 'REFUSED'; repairSummary?: string; repairCost?: number | null }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const locationId = typeof b?.locationId === 'string' ? b.locationId : ''
  const rawItems: unknown[] = Array.isArray(b?.items) ? b.items : []
  if (!locationId) return NextResponse.json({ error: 'Select a destination location' }, { status: 400 })

  const items: ReceiveItem[] = rawItems
    .map((x) => x as Record<string, unknown>)
    .filter(x => typeof x?.itemId === 'string' && (x.status === 'REPAIRED' || x.status === 'REFUSED'))
    .map(x => ({
      itemId: x.itemId as string,
      status: x.status as 'REPAIRED' | 'REFUSED',
      repairSummary: typeof x.repairSummary === 'string' ? x.repairSummary.trim() : undefined,
      repairCost: x.repairCost === null || x.repairCost === undefined || x.repairCost === '' ? undefined : Number(x.repairCost),
    }))
  if (items.length === 0) return NextResponse.json({ error: 'No units to receive' }, { status: 400 })

  const dest = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true, name: true } })
  if (!dest) return NextResponse.json({ error: 'Destination location not found' }, { status: 404 })

  const order = await prisma.repairOrder.findUnique({
    where: { id: params.id },
    select: { id: true, orderNumber: true, vendor: { select: { companyName: true } } },
  })
  if (!order) return NextResponse.json({ error: 'Repair order not found' }, { status: 404 })

  // Load the target items with their serial + repair type.
  const dbItems = await prisma.repairOrderItem.findMany({
    where: { id: { in: items.map(i => i.itemId) }, repairOrderId: params.id },
    select: {
      id: true, repairCost: true,
      repairType: { select: { name: true } },
      inventorySerial: { select: { id: true, serialNumber: true, productId: true, gradeId: true, locationId: true } },
    },
  })
  const byId = new Map(dbItems.map(i => [i.id, i]))

  const vendor = order.vendor.companyName
  const now = new Date()
  const productIds = new Set<string>()
  // InventoryItem adjustments grouped by (product, fromLocation, grade).
  const decGroups = new Map<string, { productId: string; fromLocationId: string; gradeId: string | null; count: number }>()

  await prisma.$transaction(async (tx) => {
    for (const input of items) {
      const it = byId.get(input.itemId)
      if (!it) continue
      const s = it.inventorySerial
      productIds.add(s.productId)

      // REPAIRED keeps/sets the cost (override if provided, else the assigned one);
      // REFUSED clears it (no charge for a declined unit).
      const cost = input.status === 'REPAIRED'
        ? (input.repairCost != null && Number.isFinite(input.repairCost) && input.repairCost >= 0
            ? new Prisma.Decimal(input.repairCost.toFixed(2))
            : it.repairCost)
        : null

      await tx.repairOrderItem.update({
        where: { id: it.id },
        data: {
          status: input.status,
          repairSummary: input.repairSummary || null,
          repairCost: cost,
          receivedAt: now,
          receivedLocationId: locationId,
        },
      })

      // Move the serial into the destination location (if not already there).
      if (s.locationId !== locationId) {
        await tx.inventorySerial.update({ where: { id: s.id }, data: { locationId, status: 'IN_STOCK' } })
        const key = `${s.productId}|${s.locationId}|${s.gradeId ?? 'NULL'}`
        const g = decGroups.get(key)
        if (g) g.count++
        else decGroups.set(key, { productId: s.productId, fromLocationId: s.locationId, gradeId: s.gradeId, count: 1 })
      }

      // Serial history: describe the work performed (or refusal), vendor, and cost.
      const rt = it.repairType?.name ?? 'Repair'
      const costStr = cost != null ? ` — $${Number(cost).toFixed(2)}` : ''
      const notes = input.status === 'REPAIRED'
        ? `Repaired (${rt}) by ${vendor}${costStr} · RO-${order.orderNumber}${input.repairSummary ? `: ${input.repairSummary}` : ''}`
        : `Repair refused by ${vendor} · RO-${order.orderNumber}${input.repairSummary ? `: ${input.repairSummary}` : ''}`
      await tx.serialHistory.create({
        data: {
          inventorySerialId: s.id,
          eventType: 'REPAIR_RETURNED',
          locationId,
          fromLocationId: s.locationId !== locationId ? s.locationId : null,
          userId: user.dbId,
          notes,
        },
      })
    }

    // Apply the grouped InventoryItem adjustments (move source → destination).
    for (const g of decGroups.values()) {
      await tx.inventoryItem.updateMany({
        where: { productId: g.productId, locationId: g.fromLocationId, gradeId: g.gradeId, qty: { gt: 0 } },
        data: { qty: { decrement: g.count } },
      })
      if (g.gradeId) {
        await tx.inventoryItem.upsert({
          where: { productId_locationId_gradeId: { productId: g.productId, locationId, gradeId: g.gradeId } },
          create: { productId: g.productId, locationId, gradeId: g.gradeId, qty: g.count },
          update: { qty: { increment: g.count } },
        })
      } else {
        const existing = await tx.inventoryItem.findFirst({ where: { productId: g.productId, locationId, gradeId: null } })
        if (existing) await tx.inventoryItem.update({ where: { id: existing.id }, data: { qty: { increment: g.count } } })
        else await tx.inventoryItem.create({ data: { productId: g.productId, locationId, gradeId: null, qty: g.count } })
      }
    }
  }, { timeout: 60_000 })

  // Complete the order once every unit has been received.
  const remaining = await prisma.repairOrderItem.count({ where: { repairOrderId: params.id, receivedAt: null } })
  if (remaining === 0) {
    await prisma.repairOrder.update({ where: { id: params.id }, data: { status: 'COMPLETED' } })
  }

  // Repaired units are back in stock — refresh marketplace qty for their products.
  pushQtyForProducts(Array.from(productIds))

  return NextResponse.json({ received: items.length, allReceived: remaining === 0, locationName: dest.name })
}
