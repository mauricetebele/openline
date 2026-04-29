import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const search = req.nextUrl.searchParams.get('search')?.trim()

  const strategies = await prisma.pricingStrategy.findMany({
    where: search
      ? { name: { contains: search, mode: 'insensitive' } }
      : undefined,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { mskuAssignments: true } } },
  })

  return NextResponse.json({ data: strategies })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, marketplace, description } = body as {
    name?: string
    marketplace?: string
    description?: string
  }

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  const validMarketplaces = ['amazon', 'backmarket']
  if (!marketplace || !validMarketplaces.includes(marketplace)) {
    return NextResponse.json({ error: 'Marketplace must be amazon or backmarket' }, { status: 400 })
  }

  const strategy = await prisma.pricingStrategy.create({
    data: {
      name: name.trim(),
      marketplace,
      description: description?.trim() || null,
    },
    include: { _count: { select: { mskuAssignments: true } } },
  })

  return NextResponse.json(strategy, { status: 201 })
}
