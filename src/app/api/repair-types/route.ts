/**
 * GET  /api/repair-types  — the bank of repair types
 * POST /api/repair-types  — add a repair type { name }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const types = await prisma.repairType.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json(types)
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const name = typeof b?.name === 'string' ? b.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const existing = await prisma.repairType.findUnique({ where: { name } })
  if (existing) return NextResponse.json({ error: 'That repair type already exists' }, { status: 409 })
  const type = await prisma.repairType.create({ data: { name } })
  return NextResponse.json(type, { status: 201 })
}
