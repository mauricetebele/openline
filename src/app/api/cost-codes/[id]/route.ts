import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { name, amount, isActive } = body

  const existing = await prisma.costCode.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Cost code not found' }, { status: 404 })

  // Check uniqueness if name is changing
  if (name !== undefined && name.trim() !== existing.name) {
    const dup = await prisma.costCode.findUnique({ where: { name: name.trim() } })
    if (dup) return NextResponse.json({ error: 'A cost code with that name already exists' }, { status: 409 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (name !== undefined) data.name = name.trim()
  if (amount !== undefined) data.amount = Number(amount)
  if (isActive !== undefined) data.isActive = Boolean(isActive)

  const updated = await prisma.costCode.update({ where: { id }, data })
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const existing = await prisma.costCode.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Cost code not found' }, { status: 404 })

  // Soft delete
  const updated = await prisma.costCode.update({
    where: { id },
    data: { isActive: false },
  })

  return NextResponse.json(updated)
}
