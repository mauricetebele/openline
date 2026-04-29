import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.canAccessOli) return NextResponse.json({ error: 'OLI access not enabled' }, { status: 403 })

  const body = await req.json()
  const { mskuIds } = body as { mskuIds?: string[] }

  if (!mskuIds?.length) {
    return NextResponse.json({ error: 'mskuIds is required' }, { status: 400 })
  }

  // Verify strategy exists
  const strategy = await prisma.pricingStrategy.findUnique({ where: { id: params.id } })
  if (!strategy) {
    return NextResponse.json({ error: 'Strategy not found' }, { status: 404 })
  }

  // Remove any existing assignments for these SKUs (a SKU can only belong to one strategy)
  await prisma.pricingStrategyMsku.deleteMany({
    where: { mskuId: { in: mskuIds } },
  })

  await prisma.pricingStrategyMsku.createMany({
    data: mskuIds.map((mskuId) => ({
      strategyId: params.id,
      mskuId,
    })),
  })

  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { mskuIds } = body as { mskuIds?: string[] }

  if (!mskuIds?.length) {
    return NextResponse.json({ error: 'mskuIds is required' }, { status: 400 })
  }

  await prisma.pricingStrategyMsku.deleteMany({
    where: {
      strategyId: params.id,
      mskuId: { in: mskuIds },
    },
  })

  return NextResponse.json({ ok: true })
}
