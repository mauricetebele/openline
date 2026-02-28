import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const locations = await prisma.location.findMany({
    where: { warehouseId: params.id },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ data: locations })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const exists = await prisma.location.findUnique({
    where: { warehouseId_name: { warehouseId: params.id, name: name.trim() } },
  })
  if (exists) return NextResponse.json({ error: 'A location with this name already exists in this warehouse' }, { status: 409 })

  const location = await prisma.location.create({
    data: { name: name.trim(), warehouseId: params.id },
  })
  return NextResponse.json(location, { status: 201 })
}
