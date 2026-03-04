import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

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

  await prisma.$transaction(async (tx) => {
    for (const serial of toMove) {
      const fromLocationId = serial.locationId

      // Update the serial's current location
      await tx.inventorySerial.update({
        where: { id: serial.id },
        data:  { locationId },
      })

      // Log a LOCATION_MOVE history event
      await tx.serialHistory.create({
        data: {
          inventorySerialId: serial.id,
          eventType:         'LOCATION_MOVE',
          locationId,        // destination
          fromLocationId,    // source
        },
      })

      // Decrement source inventory item (guard against going below 0)
      await tx.inventoryItem.updateMany({
        where: { productId: serial.productId, locationId: fromLocationId, gradeId: serial.gradeId, qty: { gt: 0 } },
        data:  { qty: { decrement: 1 } },
      })

      // Upsert destination inventory item
      // Prisma's composite-unique upsert rejects null, so handle null gradeId separately
      const moveGradeId = serial.gradeId ?? null
      if (moveGradeId) {
        await tx.inventoryItem.upsert({
          where:  { productId_locationId_gradeId: { productId: serial.productId, locationId, gradeId: moveGradeId } },
          create: { productId: serial.productId, locationId, gradeId: moveGradeId, qty: 1 },
          update: { qty: { increment: 1 } },
        })
      } else {
        const existingInv = await tx.inventoryItem.findFirst({
          where: { productId: serial.productId, locationId, gradeId: null },
        })
        if (existingInv) {
          await tx.inventoryItem.update({ where: { id: existingInv.id }, data: { qty: { increment: 1 } } })
        } else {
          await tx.inventoryItem.create({ data: { productId: serial.productId, locationId, gradeId: null, qty: 1 } })
        }
      }
    }
  })

  return NextResponse.json({ movedCount: toMove.length })
}
