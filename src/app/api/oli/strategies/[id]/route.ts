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

  // Active qty + price + ASIN from SellerListing
  const listings = sellerSkus.length > 0
    ? await prisma.sellerListing.findMany({
        where: { sku: { in: sellerSkus } },
        select: { sku: true, quantity: true, price: true, asin: true, accountId: true, listingStatus: true },
      })
    : []

  const activeQtyMap = new Map<string, number>()
  const priceMap = new Map<string, number>()
  const asinMap = new Map<string, string>()
  const accountIdMap = new Map<string, string>()
  const listingStatusMap = new Map<string, string>()
  for (const l of listings) {
    activeQtyMap.set(l.sku, (activeQtyMap.get(l.sku) ?? 0) + l.quantity)
    if (l.price != null && !priceMap.has(l.sku)) {
      priceMap.set(l.sku, Number(l.price))
    }
    if (l.asin && !asinMap.has(l.sku)) {
      asinMap.set(l.sku, l.asin)
      accountIdMap.set(l.sku, l.accountId)
    }
    if (l.listingStatus && !listingStatusMap.has(l.sku)) {
      listingStatusMap.set(l.sku, l.listingStatus)
    }
  }

  // Buy Box data is fetched separately via /api/oli/strategies/[id]/buybox
  // to avoid blocking the main response (SP-API rate limit: 2.1s per ASIN)

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

  // Build enriched response
  const enriched = {
    ...strategy,
    mskuAssignments: strategy.mskuAssignments.map((a) => {
      const pgKey = `${a.msku.product.id}|${a.msku.grade?.id ?? ''}`
      const onHand = fgOnHandMap.get(pgKey) ?? 0
      const pending = pendingMap.get(a.msku.sellerSku) ?? 0
      const wholesale = wholesaleMap.get(pgKey) ?? 0
      return {
        ...a,
        asin: asinMap.get(a.msku.sellerSku) ?? null,
        listingStatus: listingStatusMap.get(a.msku.sellerSku) ?? null,
        activeQty: activeQtyMap.get(a.msku.sellerSku) ?? 0,
        currentPrice: priceMap.get(a.msku.sellerSku) ?? null,
        fgQty: Math.max(0, onHand - pending - wholesale),
        buyBoxPrice: null,
        buyBoxWinner: null,
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
