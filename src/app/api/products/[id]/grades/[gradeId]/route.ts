/**
 * PUT    /api/products/[id]/grades/[gradeId]  — update a grade
 * DELETE /api/products/[id]/grades/[gradeId]  — delete a grade (if no inventory exists)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; gradeId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { grade, description, sortOrder } = body as {
    grade?: string
    description?: string
    sortOrder?: number
  }

  const existing = await prisma.productGrade.findUnique({ where: { id: params.gradeId } })
  if (!existing || existing.productId !== params.id) {
    return NextResponse.json({ error: 'Grade not found' }, { status: 404 })
  }

  try {
    const updated = await prisma.productGrade.update({
      where: { id: params.gradeId },
      data: {
        ...(grade !== undefined ? { grade: grade.trim().toUpperCase() } : {}),
        ...(description !== undefined ? { description: description.trim() || null } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      },
      include: { marketplaceSkus: true },
    })
    return NextResponse.json(updated)
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2002') {
      return NextResponse.json({ error: 'A grade with that name already exists for this product' }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; gradeId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.productGrade.findUnique({ where: { id: params.gradeId } })
  if (!existing || existing.productId !== params.id) {
    return NextResponse.json({ error: 'Grade not found' }, { status: 404 })
  }

  // Block deletion if inventory exists for this grade
  const [serialCount, itemCount] = await Promise.all([
    prisma.inventorySerial.count({ where: { gradeId: params.gradeId } }),
    prisma.inventoryItem.count({ where: { gradeId: params.gradeId, qty: { gt: 0 } } }),
  ])

  if (serialCount > 0 || itemCount > 0) {
    return NextResponse.json(
      { error: 'Cannot delete this grade — inventory exists for it. Remove all stock first.' },
      { status: 409 },
    )
  }

  await prisma.productGrade.delete({ where: { id: params.gradeId } })
  return NextResponse.json({ ok: true })
}
