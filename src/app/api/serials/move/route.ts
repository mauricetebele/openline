import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { serialIds, locationId } = body as { serialIds: string[]; locationId: string }

  if (!Array.isArray(serialIds) || serialIds.length === 0) {
    return NextResponse.json({ error: 'serialIds array is required' }, { status: 400 })
  }
  if (!locationId) {
    return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
  }

  // Validate destination location exists
  const destLocation = await prisma.location.findUnique({ where: { id: locationId } })
  if (!destLocation) {
    return NextResponse.json({ error: 'Destination location not found' }, { status: 404 })
  }

  // Load the serials to move
  const serials = await prisma.inventorySerial.findMany({
    where: { id: { in: serialIds } },
    select: { id: true, productId: true, locationId: true, gradeId: true },
  })

  if (serials.length !== serialIds.length) {
    return NextResponse.json({ error: 'One or more serial numbers not found' }, { status: 404 })
  }

  // Only move serials that aren't already at the destination
  const toMove = serials.filter(s => s.locationId !== locationId)
  if (toMove.length === 0) {
    return NextResponse.json({ error: 'All selected serials are already at that location' }, { status: 400 })
  }

  // Serials assigned to an active (serialized, not-yet-shipped) order or FBA
  // shipment are locked to their location — they can't be moved until the order
  // is unserialized / shipped / cancelled. Keeps a serialized order's reservation
  // aligned with where its serials physically are.
  const moveIds = toMove.map(s => s.id)
  const [oAssign, soAssign, fbaAssign] = await Promise.all([
    prisma.orderSerialAssignment.findMany({ where: { inventorySerialId: { in: moveIds }, order: { workflowStatus: { notIn: ['SHIPPED', 'CANCELLED'] } } }, select: { inventorySerialId: true } }),
    prisma.salesOrderSerialAssignment.findMany({ where: { serialId: { in: moveIds }, salesOrder: { fulfillmentStatus: { notIn: ['SHIPPED', 'CANCELLED'] } } }, select: { serialId: true } }),
    prisma.fbaShipmentSerialAssignment.findMany({ where: { inventorySerialId: { in: moveIds }, fbaShipment: { status: { notIn: ['SHIPPED', 'CANCELLED'] } } }, select: { inventorySerialId: true } }),
  ])
  const lockedIds = new Set<string>([
    ...oAssign.map(a => a.inventorySerialId),
    ...soAssign.map(a => a.serialId),
    ...fbaAssign.map(a => a.inventorySerialId),
  ])
  if (lockedIds.size > 0) {
    const locked = await prisma.inventorySerial.findMany({ where: { id: { in: Array.from(lockedIds) } }, select: { serialNumber: true } })
    const names = locked.map(l => l.serialNumber)
    return NextResponse.json({
      error: `Cannot move — ${lockedIds.size} serial${lockedIds.size > 1 ? 's are' : ' is'} assigned to an active order/shipment and locked to their location: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` (+${names.length - 5} more)` : ''}. Unserialize the order first.`,
    }, { status: 409 })
  }

  // Group by (productId, fromLocationId, gradeId) for batched inventory adjustments
  const groups = new Map<string, { productId: string; fromLocationId: string; gradeId: string | null; count: number }>()
  for (const serial of toMove) {
    const key = `${serial.productId}|${serial.locationId}|${serial.gradeId ?? 'NULL'}`
    const existing = groups.get(key)
    if (existing) {
      existing.count++
    } else {
      groups.set(key, { productId: serial.productId, fromLocationId: serial.locationId, gradeId: serial.gradeId, count: 1 })
    }
  }

  await prisma.$transaction(async (tx) => {
    // 1. Bulk update all serials to the new location
    await tx.inventorySerial.updateMany({
      where: { id: { in: toMove.map(s => s.id) } },
      data: { locationId },
    })

    // 2. Bulk create history events
    await tx.serialHistory.createMany({
      data: toMove.map(serial => ({
        inventorySerialId: serial.id,
        eventType: 'LOCATION_MOVE' as const,
        locationId,
        fromLocationId: serial.locationId,
        userId: user.dbId,
      })),
    })

    // 3. Adjust inventory items per group (not per serial)
    for (const group of groups.values()) {
      // Decrement source
      await tx.inventoryItem.updateMany({
        where: { productId: group.productId, locationId: group.fromLocationId, gradeId: group.gradeId, qty: { gt: 0 } },
        data: { qty: { decrement: group.count } },
      })

      // Upsert destination
      if (group.gradeId) {
        await tx.inventoryItem.upsert({
          where: { productId_locationId_gradeId: { productId: group.productId, locationId, gradeId: group.gradeId } },
          create: { productId: group.productId, locationId, gradeId: group.gradeId, qty: group.count },
          update: { qty: { increment: group.count } },
        })
      } else {
        const existingInv = await tx.inventoryItem.findFirst({
          where: { productId: group.productId, locationId, gradeId: null },
        })
        if (existingInv) {
          await tx.inventoryItem.update({ where: { id: existingInv.id }, data: { qty: { increment: group.count } } })
        } else {
          await tx.inventoryItem.create({ data: { productId: group.productId, locationId, gradeId: null, qty: group.count } })
        }
      }
    }
  }, { timeout: 30_000 })

  return NextResponse.json({ movedCount: toMove.length })
}
