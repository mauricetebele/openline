import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { serialIds, toProductId } = body as { serialIds: string[]; toProductId: string }

  if (!Array.isArray(serialIds) || serialIds.length === 0) {
    return NextResponse.json({ error: 'serialIds array is required' }, { status: 400 })
  }
  if (!toProductId) {
    return NextResponse.json({ error: 'toProductId is required' }, { status: 400 })
  }

  // Validate target product exists and is serializable
  const targetProduct = await prisma.product.findUnique({ where: { id: toProductId } })
  if (!targetProduct) {
    return NextResponse.json({ error: 'Target product not found' }, { status: 404 })
  }
  if (!targetProduct.isSerializable) {
    return NextResponse.json({ error: 'Target product is not serializable' }, { status: 400 })
  }

  // Load the serials
  const serials = await prisma.inventorySerial.findMany({
    where: { id: { in: serialIds } },
    select: { id: true, serialNumber: true, productId: true, locationId: true, gradeId: true, status: true },
  })

  if (serials.length !== serialIds.length) {
    return NextResponse.json({ error: 'One or more serial numbers not found' }, { status: 404 })
  }

  // Reject any SOLD serials
  const soldSerials = serials.filter(s => s.status === 'SOLD')
  if (soldSerials.length > 0) {
    const sns = soldSerials.map(s => s.serialNumber).join(', ')
    return NextResponse.json(
      { error: `The following serials have been shipped out and cannot be converted: ${sns}` },
      { status: 400 },
    )
  }

  // Skip serials already on the target product
  const toConvert = serials.filter(s => s.productId !== toProductId)
  if (toConvert.length === 0) {
    return NextResponse.json({ error: 'All selected serials are already on that SKU' }, { status: 400 })
  }

  // Check for serial number conflicts on the target product
  const snList      = toConvert.map(s => s.serialNumber)
  const conflicts   = await prisma.inventorySerial.findMany({
    where: { productId: toProductId, serialNumber: { in: snList } },
    select: { serialNumber: true },
  })
  if (conflicts.length > 0) {
    const dupes = conflicts.map(c => c.serialNumber).join(', ')
    return NextResponse.json(
      { error: `These serial numbers already exist under the target SKU: ${dupes}` },
      { status: 409 },
    )
  }

  // Execute in a single transaction
  await prisma.$transaction(async (tx) => {
    for (const serial of toConvert) {
      const fromProductId = serial.productId

      // Update the serial's product
      await tx.inventorySerial.update({
        where: { id: serial.id },
        data:  { productId: toProductId },
      })

      // Log a SKU_CONVERSION history event
      await tx.serialHistory.create({
        data: {
          inventorySerialId: serial.id,
          eventType:         'SKU_CONVERSION',
          fromProductId,
          toProductId,
          locationId:        serial.locationId,
        },
      })

      // Decrement source product's inventory count at this location (preserving grade)
      await tx.inventoryItem.updateMany({
        where: { productId: fromProductId, locationId: serial.locationId, gradeId: serial.gradeId, qty: { gt: 0 } },
        data:  { qty: { decrement: 1 } },
      })

      // Upsert destination product's inventory count (preserving grade)
      // Prisma's composite-unique upsert rejects null, so handle null gradeId separately
      const destGradeId = serial.gradeId ?? null
      if (destGradeId) {
        await tx.inventoryItem.upsert({
          where:  { productId_locationId_gradeId: { productId: toProductId, locationId: serial.locationId, gradeId: destGradeId } },
          create: { productId: toProductId, locationId: serial.locationId, gradeId: destGradeId, qty: 1 },
          update: { qty: { increment: 1 } },
        })
      } else {
        const existingInv = await tx.inventoryItem.findFirst({
          where: { productId: toProductId, locationId: serial.locationId, gradeId: null },
        })
        if (existingInv) {
          await tx.inventoryItem.update({ where: { id: existingInv.id }, data: { qty: { increment: 1 } } })
        } else {
          await tx.inventoryItem.create({ data: { productId: toProductId, locationId: serial.locationId, gradeId: null, qty: 1 } })
        }
      }
    }
  })

  return NextResponse.json({ convertedCount: toConvert.length })
}
