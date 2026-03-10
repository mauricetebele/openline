import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const active = req.nextUrl.searchParams.get('active')

  const where = active === 'true' ? { isActive: true } : active === 'false' ? { isActive: false } : {}

  const costCodes = await prisma.costCode.findMany({
    where,
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({ data: costCodes })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, amount } = body

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (amount === undefined || amount === null || Number(amount) < 0) {
    return NextResponse.json({ error: 'Amount must be 0 or more' }, { status: 400 })
  }

  const existing = await prisma.costCode.findUnique({ where: { name: name.trim() } })
  if (existing) return NextResponse.json({ error: 'A cost code with that name already exists' }, { status: 409 })

  const costCode = await prisma.costCode.create({
    data: { name: name.trim(), amount: Number(amount) },
  })

  return NextResponse.json(costCode, { status: 201 })
}
