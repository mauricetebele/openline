/**
 * POST /api/inventory/regrade
 * Change the grade of inventory units.
 *
 * Two modes:
 *
 * type "serial" — for serializable products:
 *   { type: "serial", serialIds: string[], toGradeId: string | null }
 *   For each serial: updates gradeId, adjusts InventoryItem counts.
 *
 * type "item" — for non-serializable products:
 *   { type: "item", productId: string, locationId: string, fromGradeId: string | null, toGradeId: string | null, qty: number }
 *   Moves qty from fromGrade's InventoryItem to toGrade's InventoryItem.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // ── Serial-based regrade ────────────────────────────────────────────────────
  if (body.type === 'serial') {
    const { serialIds, toGradeId } = body as { serialIds: string[]; toGradeId: string | null }

    if (!Array.isArray(serialIds) || serialIds.length === 0) {
      return NextResponse.json({ error: 'serialIds array is required' }, { status: 400 })
    }

    // Validate destination grade exists (if provided)
    if (toGradeId) {
      const gradeExists = await prisma.grade.findUnique({ where: { id: toGradeId } })
      if (!gradeExists) return NextResponse.json({ error: 'Target grade not found' }, { status: 404 })
    }

    // Load serials with current grade/location
    const serials = await prisma.inventorySerial.findMany({
      where: { id: { in: serialIds } },
      select: { id: true, productId: true, locationId: true, gradeId: true },
    })

    if (serials.length !== serialIds.length) {
      return NextResponse.json({ error: 'One or more serials not found' }, { status: 404 })
    }

    // Filter out serials that are already the target grade
    const toRegrade = serials.filter(s => s.gradeId !== toGradeId)
    if (toRegrade.length === 0) {
      return NextResponse.json({ error: 'All selected serials already have the target grade' }, { status: 400 })
    }

    await prisma.$transaction(async tx => {
      for (const serial of toRegrade) {
        const fromGradeId = serial.gradeId

        // Update the serial's grade
        await tx.inventorySerial.update({
          where: { id: serial.id },
          data:  { gradeId: toGradeId ?? null },
        })

        // Decrement from-grade inventory item
        await tx.inventoryItem.updateMany({
          where: {
            productId:  serial.productId,
            locationId: serial.locationId,
            gradeId:    fromGradeId,
            qty:        { gt: 0 },
          },
          data: { qty: { decrement: 1 } },
        })

        // Upsert to-grade inventory item
        // Prisma's composite-unique upsert rejects null, so handle null gradeId separately
        const toGrade = toGradeId ?? null
        if (toGrade) {
          await tx.inventoryItem.upsert({
            where:  { productId_locationId_gradeId: { productId: serial.productId, locationId: serial.locationId, gradeId: toGrade } },
            create: { productId: serial.productId, locationId: serial.locationId, gradeId: toGrade, qty: 1 },
            update: { qty: { increment: 1 } },
          })
        } else {
          const existingInv = await tx.inventoryItem.findFirst({
            where: { productId: serial.productId, locationId: serial.locationId, gradeId: null },
          })
          if (existingInv) {
            await tx.inventoryItem.update({ where: { id: existingInv.id }, data: { qty: { increment: 1 } } })
          } else {
            await tx.inventoryItem.create({ data: { productId: serial.productId, locationId: serial.locationId, gradeId: null, qty: 1 } })
          }
        }
      }
    })

    return NextResponse.json({ regraded: toRegrade.length })
  }

  // ── Item-based regrade (non-serializable) ───────────────────────────────────
  if (body.type === 'item') {
    const { productId, locationId, fromGradeId, toGradeId, qty } = body as {
      productId:   string
      locationId:  string
      fromGradeId: string | null
      toGradeId:   string | null
      qty:         number
    }

    if (!productId || !locationId) {
      return NextResponse.json({ error: 'productId and locationId are required' }, { status: 400 })
    }
    if (!qty || qty < 1) {
      return NextResponse.json({ error: 'qty must be at least 1' }, { status: 400 })
    }
    if (fromGradeId === toGradeId) {
      return NextResponse.json({ error: 'fromGradeId and toGradeId must be different' }, { status: 400 })
    }

    // Check source item has enough stock
    // Prisma's composite-unique rejects null, so handle null gradeId separately
    const sourceItem = fromGradeId
      ? await prisma.inventoryItem.findUnique({
          where: { productId_locationId_gradeId: { productId, locationId, gradeId: fromGradeId } },
        })
      : await prisma.inventoryItem.findFirst({
          where: { productId, locationId, gradeId: null },
        })
    if (!sourceItem || sourceItem.qty < qty) {
      return NextResponse.json(
        { error: `Insufficient stock — available: ${sourceItem?.qty ?? 0}` },
        { status: 409 },
      )
    }

    await prisma.$transaction(async tx => {
      // Decrement source (use id since we already found it)
      await tx.inventoryItem.update({
        where: { id: sourceItem.id },
        data:  { qty: { decrement: qty } },
      })

      // Upsert destination
      if (toGradeId) {
        await tx.inventoryItem.upsert({
          where:  { productId_locationId_gradeId: { productId, locationId, gradeId: toGradeId } },
          create: { productId, locationId, gradeId: toGradeId, qty },
          update: { qty: { increment: qty } },
        })
      } else {
        const existingDest = await tx.inventoryItem.findFirst({
          where: { productId, locationId, gradeId: null },
        })
        if (existingDest) {
          await tx.inventoryItem.update({ where: { id: existingDest.id }, data: { qty: { increment: qty } } })
        } else {
          await tx.inventoryItem.create({ data: { productId, locationId, gradeId: null, qty } })
        }
      }
    })

    return NextResponse.json({ regraded: qty })
  }

  return NextResponse.json({ error: 'Invalid type — must be "serial" or "item"' }, { status: 400 })
}
