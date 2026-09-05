/**
 * GET  /api/product-families        — list families (with member counts)
 * POST /api/product-families         — create { name }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const families = await prisma.productFamily.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  })
  return NextResponse.json({ families: families.map(f => ({ id: f.id, name: f.name, memberCount: f._count.products })) })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = String(body?.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'A family name is required' }, { status: 400 })

  const exists = await prisma.productFamily.findUnique({ where: { name } })
  if (exists) return NextResponse.json({ error: 'A family with that name already exists' }, { status: 409 })

  const family = await prisma.productFamily.create({ data: { name } })
  return NextResponse.json({ family: { id: family.id, name: family.name, memberCount: 0 } }, { status: 201 })
}
