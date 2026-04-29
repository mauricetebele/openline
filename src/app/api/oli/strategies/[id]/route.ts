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
              product: { select: { id: true, sku: true, description: true } },
              grade: { select: { id: true, grade: true } },
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

  // Enrich with active marketplace qty, price, and finished-goods inventory
  const sellerSkus = strategy.mskuAssignments.map((a) => a.msku.sellerSku)
  const productGradeKeys = strategy.mskuAssignments.map((a) => ({
    productId: a.msku.product.id,
    gradeId: a.msku.grade?.id ?? null,
  }))

  // Active qty + price from SellerListing (sum qty across accounts, take first non-null price)
  const listings = sellerSkus.length > 0
    ? await prisma.sellerListing.findMany({
        where: { sku: { in: sellerSkus } },
        select: { sku: true, quantity: true, price: true },
      })
    : []

  const activeQtyMap = new Map<string, number>()
  const priceMap = new Map<string, number>()
  for (const l of listings) {
    activeQtyMap.set(l.sku, (activeQtyMap.get(l.sku) ?? 0) + l.quantity)
    if (l.price != null && !priceMap.has(l.sku)) {
      priceMap.set(l.sku, Number(l.price))
    }
  }

  // FG qty from InventoryItem grouped by productId+gradeId
  const uniquePgKeys = Array.from(
    new Map(
      productGradeKeys.map((k) => [`${k.productId}|${k.gradeId ?? ''}`, k]),
    ).values(),
  )

  const fgGroups = uniquePgKeys.length > 0
    ? await prisma.inventoryItem.groupBy({
        by: ['productId', 'gradeId'],
        where: {
          OR: uniquePgKeys.map((k) => ({
            productId: k.productId,
            gradeId: k.gradeId,
          })),
          location: { isFinishedGoods: true },
        },
        _sum: { qty: true },
      })
    : []

  const fgMap = new Map<string, number>()
  for (const g of fgGroups) {
    fgMap.set(`${g.productId}|${g.gradeId ?? ''}`, g._sum.qty ?? 0)
  }

  // Build enriched response
  const enriched = {
    ...strategy,
    mskuAssignments: strategy.mskuAssignments.map((a) => ({
      ...a,
      activeQty: activeQtyMap.get(a.msku.sellerSku) ?? 0,
      currentPrice: priceMap.get(a.msku.sellerSku) ?? null,
      fgQty: fgMap.get(`${a.msku.product.id}|${a.msku.grade?.id ?? ''}`) ?? 0,
    })),
  }

  return NextResponse.json(enriched)
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
