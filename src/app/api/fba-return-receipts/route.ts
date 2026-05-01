import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

// ─── GET: List FBA Return Receipts ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const search = req.nextUrl.searchParams.get('search')?.trim()

  const where: Record<string, unknown> = {}
  if (search) {
    where.OR = [
      { receiptNumber: { contains: search, mode: 'insensitive' } },
      { serialNumber: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
    ]
  }

  const receipts = await prisma.fbaReturnReceipt.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { sku: true, description: true } },
      grade: { select: { id: true, grade: true } },
      location: {
        select: { name: true, warehouse: { select: { name: true } } },
      },
      fbaShipment: { select: { shipmentNumber: true } },
      receivedBy: { select: { name: true } },
    },
  })

  return NextResponse.json({ data: receipts })
}

// ─── POST: Receive Serial Back from FBA ──────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { inventorySerialId, locationId, gradeId, note } = body as {
    inventorySerialId: string
    locationId: string
    gradeId?: string | null
    note?: string
  }

  if (!inventorySerialId) return NextResponse.json({ error: 'Serial is required' }, { status: 400 })
  if (!locationId) return NextResponse.json({ error: 'Location is required' }, { status: 400 })

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Re-validate serial state
      const serial = await tx.inventorySerial.findUnique({
        where: { id: inventorySerialId },
        include: {
          product: { select: { id: true, sku: true, description: true } },
          grade: { select: { id: true, grade: true } },
          fbaShipmentAssignment: {
            include: {
              fbaShipment: { select: { id: true, shipmentNumber: true } },
            },
          },
        },
      })

      if (!serial) throw new Error('Serial not found')
      if (serial.status !== 'OUT_OF_STOCK') throw new Error('Serial is not OUT_OF_STOCK')
      if (!serial.fbaShipmentAssignment) throw new Error('Serial has no FBA shipment assignment')

      const previousGradeId = serial.gradeId
      const finalGradeId = gradeId ?? serial.gradeId // keep existing grade if not regraded
      const fbaShipmentId = serial.fbaShipmentAssignment.fbaShipmentId

      // 2. Update InventorySerial → IN_STOCK, set location, optionally regrade
      await tx.inventorySerial.update({
        where: { id: inventorySerialId },
        data: {
          status: 'IN_STOCK',
          locationId,
          gradeId: finalGradeId,
          note: note?.trim() || serial.note,
        },
      })

      // 3. Delete FbaShipmentSerialAssignment (frees unique constraint for re-shipment)
      await tx.fbaShipmentSerialAssignment.delete({
        where: { id: serial.fbaShipmentAssignment.id },
      })

      // 4. Create SerialHistory event (FBA_RETURN)
      await tx.serialHistory.create({
        data: {
          inventorySerialId,
          eventType: 'FBA_RETURN',
          locationId,
          fbaShipmentId,
          userId: user.dbId,
          notes: note?.trim() || `Received back from FBA shipment ${serial.fbaShipmentAssignment.fbaShipment.shipmentNumber ?? ''}`.trim(),
        },
      })

      // 5. Increment InventoryItem qty (upsert pattern)
      if (finalGradeId) {
        await tx.inventoryItem.upsert({
          where: {
            productId_locationId_gradeId: {
              productId: serial.productId,
              locationId,
              gradeId: finalGradeId,
            },
          },
          create: {
            productId: serial.productId,
            locationId,
            gradeId: finalGradeId,
            qty: 1,
          },
          update: { qty: { increment: 1 } },
        })
      } else {
        const existing = await tx.inventoryItem.findFirst({
          where: { productId: serial.productId, locationId, gradeId: null },
        })
        if (existing) {
          await tx.inventoryItem.update({
            where: { id: existing.id },
            data: { qty: { increment: 1 } },
          })
        } else {
          await tx.inventoryItem.create({
            data: {
              productId: serial.productId,
              locationId,
              gradeId: null,
              qty: 1,
            },
          })
        }
      }

      // 6. Generate receipt number (FBA-RET-0001)
      const last = await tx.fbaReturnReceipt.findFirst({ orderBy: { createdAt: 'desc' } })
      let nextNum = 1
      if (last) {
        const match = last.receiptNumber.match(/FBA-RET-(\d+)/)
        if (match) nextNum = parseInt(match[1], 10) + 1
      }
      const receiptNumber = `FBA-RET-${String(nextNum).padStart(4, '0')}`

      // 7. Create FbaReturnReceipt record
      const receipt = await tx.fbaReturnReceipt.create({
        data: {
          receiptNumber,
          inventorySerialId,
          productId: serial.productId,
          fbaShipmentId,
          serialNumber: serial.serialNumber,
          sku: serial.product.sku,
          gradeId: finalGradeId,
          previousGradeId: gradeId && gradeId !== previousGradeId ? previousGradeId : null,
          locationId,
          note: note?.trim() || null,
          receivedById: user.dbId,
        },
        include: {
          product: { select: { sku: true, description: true } },
          grade: { select: { id: true, grade: true } },
          location: {
            select: { name: true, warehouse: { select: { name: true } } },
          },
          fbaShipment: { select: { shipmentNumber: true } },
          receivedBy: { select: { name: true } },
        },
      })

      return receipt
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error('[FBA-Return] Transaction error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
