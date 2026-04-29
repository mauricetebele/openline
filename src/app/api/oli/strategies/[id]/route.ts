import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const strategy = await prisma.pricingStrategy.findUnique({
    where: { id: params.id },
    include: {
      mskuAssignments: {
        include: {
          msku: {
            include: {
              product: { select: { sku: true, description: true } },
              grade: { select: { grade: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!strategy) {
    return NextResponse.json({ error: 'Strategy not found' }, { status: 404 })
  }

  return NextResponse.json(strategy)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, description, isActive } = body as {
    name?: string
    description?: string
    isActive?: boolean
  }

  if (name !== undefined && !name.trim()) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (name !== undefined) data.name = name.trim()
  if (description !== undefined) data.description = description?.trim() || null
  if (typeof isActive === 'boolean') data.isActive = isActive

  const strategy = await prisma.pricingStrategy.update({
    where: { id: params.id },
    data,
    include: { _count: { select: { mskuAssignments: true } } },
  })

  return NextResponse.json(strategy)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.pricingStrategy.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
