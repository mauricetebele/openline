import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const location = await prisma.location.update({
    where: { id: params.id },
    data: { name: name.trim() },
  })
  return NextResponse.json(location)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Toggle isFinishedGoods — only one location can be designated at a time
  if (typeof body.isFinishedGoods === 'boolean') {
    const location = await prisma.$transaction(async (tx) => {
      if (body.isFinishedGoods) {
        // Clear flag from all other locations first
        await tx.location.updateMany({
          where: { id: { not: params.id } },
          data: { isFinishedGoods: false },
        })
      }
      return tx.location.update({
        where: { id: params.id },
        data: { isFinishedGoods: body.isFinishedGoods },
      })
    })
    return NextResponse.json(location)
  }

  return NextResponse.json({ error: 'No valid field to update' }, { status: 400 })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasInventory = await prisma.inventoryItem.findFirst({
    where: { locationId: params.id, qty: { gt: 0 } },
  })
  if (hasInventory) {
    return NextResponse.json(
      { error: 'Cannot delete — this location has inventory. Move or clear inventory first.' },
      { status: 409 },
    )
  }

  await prisma.location.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
