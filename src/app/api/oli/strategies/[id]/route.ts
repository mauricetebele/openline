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

  // Enrich with OLI's own cached data (synced via /api/oli/sync)
  const sellerSkus = strategy.mskuAssignments.map((a) => a.msku.sellerSku)
  const productGradeKeys = strategy.mskuAssignments.map((a) => ({
    productId: a.msku.product.id,
    gradeId: a.msku.grade?.id ?? null,
  }))

  // Read from OLI's own cache table
  const cached = sellerSkus.length > 0
    ? await prisma.oliSkuCache.findMany({
        where: { sellerSku: { in: sellerSkus } },
      })
    : []

  const cacheMap = new Map(cached.map((c) => [c.sellerSku, c]))

  // FG available qty = on-hand - pending MFN orders - wholesale soft reservations
  const uniquePgKeys = Array.from(
    new Map(
      productGradeKeys.map((k) => [`${k.productId}|${k.gradeId ?? ''}`, k]),
    ).values(),
  )
  const productIds = Array.from(new Set(productGradeKeys.map((k) => k.productId)))

  // On-hand FG inventory
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

  const fgOnHandMap = new Map<string, number>()
  for (const g of fgGroups) {
    fgOnHandMap.set(`${g.productId}|${g.gradeId ?? ''}`, g._sum.qty ?? 0)
  }

  // Pending Amazon MFN order qty (not yet reserved in inventory)
  const pendingMap = new Map<string, number>()
  if (sellerSkus.length > 0) {
    const pendingGroups = await prisma.orderItem.groupBy({
      by: ['sellerSku'],
      where: {
        sellerSku: { in: sellerSkus },
        order: {
          fulfillmentChannel: 'MFN',
          orderSource: 'amazon',
          workflowStatus: 'PENDING',
        },
      },
      _sum: { quantityOrdered: true, quantityShipped: true },
    })
    for (const g of pendingGroups) {
      if (g.sellerSku) {
        pendingMap.set(g.sellerSku, (g._sum.quantityOrdered ?? 0) - (g._sum.quantityShipped ?? 0))
      }
    }
  }

  // Wholesale soft-reserved qty (PROCESSING orders in FG locations)
  const whGroups = productIds.length > 0
    ? await prisma.salesOrderInventoryReservation.groupBy({
        by: ['productId', 'gradeId'],
        where: {
          productId: { in: productIds },
          location: { isFinishedGoods: true },
          salesOrder: { fulfillmentStatus: { in: ['PROCESSING'] } },
        },
        _sum: { qtyReserved: true },
      })
    : []

  const wholesaleMap = new Map<string, number>()
  for (const g of whGroups) {
    wholesaleMap.set(`${g.productId}|${g.gradeId ?? ''}`, g._sum.qtyReserved ?? 0)
  }

  // Find the oldest sync timestamp for display
  const syncTimes = cached.map((c) => c.lastSyncedAt.getTime()).filter(Boolean)
  const lastSyncedAt = syncTimes.length > 0
    ? new Date(Math.min(...syncTimes)).toISOString()
    : null

  // Build enriched response
  const enriched = {
    ...strategy,
    lastSyncedAt,
    mskuAssignments: strategy.mskuAssignments.map((a) => {
      const pgKey = `${a.msku.product.id}|${a.msku.grade?.id ?? ''}`
      const onHand = fgOnHandMap.get(pgKey) ?? 0
      const pending = pendingMap.get(a.msku.sellerSku) ?? 0
      const wholesale = wholesaleMap.get(pgKey) ?? 0
      const c = cacheMap.get(a.msku.sellerSku)
      return {
        ...a,
        asin: c?.asin ?? null,
        title: c?.title ?? null,
        listingStatus: c?.listingStatus ?? null,
        activeSince: c?.activeSince?.toISOString() ?? null,
        activeQty: c?.activeQty ?? 0,
        currentPrice: c?.price != null ? Number(c.price) : null,
        fgQty: Math.max(0, onHand - pending - wholesale),
        buyBoxPrice: c?.buyBoxPrice != null ? Number(c.buyBoxPrice) : null,
        buyBoxWinner: c?.buyBoxWinner ?? null,
      }
    }),
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
