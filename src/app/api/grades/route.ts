import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/grades — list all global grades */
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const grades = await prisma.grade.findMany({
    orderBy: [{ sortOrder: 'asc' }, { grade: 'asc' }],
  })

  return NextResponse.json({ data: grades })
}

/** POST /api/grades — create a new global grade */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const raw = (body.grade as string | undefined)?.trim().toUpperCase()
  if (!raw) return NextResponse.json({ error: 'Grade is required' }, { status: 400 })

  try {
    const created = await prisma.grade.create({
      data: { grade: raw, description: body.description?.trim() || null },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2002') {
      return NextResponse.json({ error: `Grade "${raw}" already exists` }, { status: 409 })
    }
    throw err
  }
}

/** DELETE /api/grades?id=xxx — delete a grade (only if not in use) */
export async function DELETE(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Check if grade is in use
  const [invItems, invSerials, orderRes, soRes] = await Promise.all([
    prisma.inventoryItem.count({ where: { gradeId: id } }),
    prisma.inventorySerial.count({ where: { gradeId: id } }),
    prisma.orderInventoryReservation.count({ where: { gradeId: id } }),
    prisma.salesOrderInventoryReservation.count({ where: { gradeId: id } }),
  ])

  const total = invItems + invSerials + orderRes + soRes
  if (total > 0) {
    return NextResponse.json(
      { error: `Cannot delete — grade is in use by ${total} inventory/reservation record(s)` },
      { status: 409 },
    )
  }

  await prisma.grade.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
