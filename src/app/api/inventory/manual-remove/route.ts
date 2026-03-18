/**
 * POST /api/inventory/manual-remove
 * Manually remove serialized inventory at a specific location.
 *
 * Body:
 *   { locationId: string; serials: string[]; reason: string }
 *
 * For each serial:
 *   - Verifies it is IN_STOCK at the given locationId
 *   - Marks the serial status as DAMAGED
 *   - Decrements the InventoryItem qty
 *   - Creates a MANUAL_REMOVE SerialHistory event
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { locationId, serials: serialNumbers, reason } = body as {
    locationId:  string
    serials:     string[]
    reason:      string
  }

  if (!locationId) {
    return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
  }
  if (!Array.isArray(serialNumbers) || serialNumbers.length === 0) {
    return NextResponse.json({ error: 'serials array is required' }, { status: 400 })
  }
  if (!reason?.trim()) {
    return NextResponse.json({ error: 'reason is required' }, { status: 400 })
  }

  const location = await prisma.location.findUnique({ where: { id: locationId } })
  if (!location) {
    return NextResponse.json({ error: 'Location not found' }, { status: 404 })
  }

  // Deduplicate and clean serial numbers
  const cleaned = Array.from(new Set(serialNumbers.map(s => s.trim()).filter(Boolean)))

  // Load the serials, filtered to IN_STOCK at the specified location
  const found = await prisma.inventorySerial.findMany({
    where: {
      serialNumber: { in: cleaned, mode: 'insensitive' },
      locationId,
      status: 'IN_STOCK',
    },
    select: { id: true, serialNumber: true, productId: true, locationId: true, gradeId: true },
  })

  const foundNums  = new Set(found.map(s => s.serialNumber.toLowerCase()))
  const notFound   = cleaned.filter(s => !foundNums.has(s.toLowerCase()))

  if (found.length === 0) {
    return NextResponse.json(
      { error: 'None of the entered serial numbers were found as IN_STOCK at this location' },
      { status: 404 },
    )
  }

  await prisma.$transaction(async tx => {
    for (const serial of found) {
      // Mark serial as DAMAGED (removed from usable stock)
      await tx.inventorySerial.update({
        where: { id: serial.id },
        data:  { status: 'DAMAGED' },
      })

      // Create MANUAL_REMOVE history event
      await tx.serialHistory.create({
        data: {
          inventorySerialId: serial.id,
          eventType:         'MANUAL_REMOVE',
          locationId,
          userId:            user.dbId,
          notes:             reason,
        },
      })

      // Decrement InventoryItem qty (guard against going negative)
      await tx.inventoryItem.updateMany({
        where: { productId: serial.productId, locationId, gradeId: serial.gradeId, qty: { gt: 0 } },
        data:  { qty: { decrement: 1 } },
      })
    }
  })

  return NextResponse.json({ removedCount: found.length, notFound })
}
