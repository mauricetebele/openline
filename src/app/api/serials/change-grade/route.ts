import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { serialIds, gradeId } = body as { serialIds: string[]; gradeId: string | null }

  if (!Array.isArray(serialIds) || serialIds.length === 0) {
    return NextResponse.json({ error: 'serialIds array is required' }, { status: 400 })
  }

  // Validate grade exists (if not clearing)
  let gradeName: string | null = null
  if (gradeId) {
    const grade = await prisma.grade.findUnique({ where: { id: gradeId }, select: { grade: true } })
    if (!grade) return NextResponse.json({ error: 'Grade not found' }, { status: 404 })
    gradeName = grade.grade
  }

  // Load serials — only process IN_STOCK ones
  const serials = await prisma.inventorySerial.findMany({
    where: { id: { in: serialIds }, status: 'IN_STOCK' },
    select: { id: true, productId: true, locationId: true, gradeId: true },
  })

  if (serials.length === 0) {
    return NextResponse.json({ error: 'No eligible IN_STOCK serials found' }, { status: 400 })
  }

  // Only change serials that have a different grade
  const toChange = serials.filter(s => s.gradeId !== gradeId)
  if (toChange.length === 0) {
    return NextResponse.json({ error: 'All selected serials already have that grade' }, { status: 400 })
  }

  // Look up old grade names for history notes
  const oldGradeIds = new Set(toChange.map(s => s.gradeId).filter(Boolean) as string[])
  const oldGradeNames = new Map<string, string>()
  if (oldGradeIds.size > 0) {
    const oldGrades = await prisma.grade.findMany({
      where: { id: { in: Array.from(oldGradeIds) } },
      select: { id: true, grade: true },
    })
    for (const g of oldGrades) oldGradeNames.set(g.id, g.grade)
  }

  // Group by (productId, locationId, oldGradeId) for batched inventory adjustments
  const groups = new Map<string, { productId: string; locationId: string; oldGradeId: string | null; count: number }>()
  for (const serial of toChange) {
    const key = `${serial.productId}|${serial.locationId}|${serial.gradeId ?? 'NULL'}`
    const existing = groups.get(key)
    if (existing) {
      existing.count++
    } else {
      groups.set(key, { productId: serial.productId, locationId: serial.locationId, oldGradeId: serial.gradeId, count: 1 })
    }
  }

  await prisma.$transaction(async (tx) => {
    // 1. Update all serials to the new grade
    await tx.inventorySerial.updateMany({
      where: { id: { in: toChange.map(s => s.id) } },
      data: { gradeId },
    })

    // 2. Create history events
    await tx.serialHistory.createMany({
      data: toChange.map(serial => ({
        inventorySerialId: serial.id,
        eventType: 'GRADE_CHANGE' as const,
        locationId: serial.locationId,
        userId: user.dbId,
        notes: `Grade changed from ${serial.gradeId ? (oldGradeNames.get(serial.gradeId) ?? serial.gradeId) : 'No Grade'} to ${gradeName ?? 'No Grade'}`,
      })),
    })

    // 3. Adjust InventoryItem qty per group
    for (const group of Array.from(groups.values())) {
      // Decrement old grade bucket
      if (group.oldGradeId) {
        await tx.inventoryItem.updateMany({
          where: { productId: group.productId, locationId: group.locationId, gradeId: group.oldGradeId, qty: { gt: 0 } },
          data: { qty: { decrement: group.count } },
        })
      } else {
        const oldItem = await tx.inventoryItem.findFirst({
          where: { productId: group.productId, locationId: group.locationId, gradeId: null, qty: { gt: 0 } },
        })
        if (oldItem) {
          await tx.inventoryItem.update({
            where: { id: oldItem.id },
            data: { qty: { decrement: group.count } },
          })
        }
      }

      // Increment new grade bucket
      if (gradeId) {
        await tx.inventoryItem.upsert({
          where: { productId_locationId_gradeId: { productId: group.productId, locationId: group.locationId, gradeId } },
          create: { productId: group.productId, locationId: group.locationId, gradeId, qty: group.count },
          update: { qty: { increment: group.count } },
        })
      } else {
        const newItem = await tx.inventoryItem.findFirst({
          where: { productId: group.productId, locationId: group.locationId, gradeId: null },
        })
        if (newItem) {
          await tx.inventoryItem.update({ where: { id: newItem.id }, data: { qty: { increment: group.count } } })
        } else {
          await tx.inventoryItem.create({ data: { productId: group.productId, locationId: group.locationId, gradeId: null, qty: group.count } })
        }
      }
    }
  })

  return NextResponse.json({ changedCount: toChange.length })
}
