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

  const warehouse = await prisma.warehouse.update({
    where: { id: params.id },
    data: { name: name.trim() },
    include: { locations: { orderBy: { name: 'asc' } } },
  })
  return NextResponse.json(warehouse)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const allowed = ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'countryCode'] as const
  const data: Record<string, string | null> = {}
  for (const key of allowed) {
    if (key in body) data[key] = body[key] ?? null
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  const warehouse = await prisma.warehouse.update({
    where: { id: params.id },
    data,
    include: { locations: { orderBy: { name: 'asc' } } },
  })
  return NextResponse.json(warehouse)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.warehouse.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
