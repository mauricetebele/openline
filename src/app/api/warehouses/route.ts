import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const warehouses = await prisma.warehouse.findMany({
    include: { locations: { orderBy: { name: 'asc' } } },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({ data: warehouses })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const warehouse = await prisma.warehouse.create({ data: { name: name.trim() } })
  return NextResponse.json(warehouse, { status: 201 })
}
