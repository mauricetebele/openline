import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search       = searchParams.get('search')?.trim()
  const serializable = searchParams.get('serializable')

  const archived = searchParams.get('archived')

  const where: Record<string, unknown> = {}
  if (archived === 'true') {
    where.archivedAt = { not: null }
  } else {
    where.archivedAt = null
  }
  if (serializable === 'true')  where.isSerializable = true
  if (serializable === 'false') where.isSerializable = false
  if (search) {
    where.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { sku:         { contains: search, mode: 'insensitive' } },
    ]
  }

  const products = await prisma.product.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ data: products })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { description, sku, isSerializable } = body

  if (!description?.trim()) return NextResponse.json({ error: 'Description is required' }, { status: 400 })
  if (!sku?.trim()) return NextResponse.json({ error: 'SKU is required' }, { status: 400 })

  const existing = await prisma.product.findUnique({ where: { sku: sku.trim() } })
  if (existing) return NextResponse.json({ error: `SKU "${sku.trim()}" is already in use` }, { status: 409 })

  const product = await prisma.product.create({
    data: {
      description: description.trim(),
      sku: sku.trim(),
      isSerializable: Boolean(isSerializable),
    },
  })

  return NextResponse.json(product, { status: 201 })
}
