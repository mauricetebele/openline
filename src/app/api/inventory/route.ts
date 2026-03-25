import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const warehouseId = searchParams.get('warehouseId')
  const locationId  = searchParams.get('locationId')
  const search      = searchParams.get('search')?.trim()
  const gradeId     = searchParams.get('gradeId')
  const productId   = searchParams.get('productId')

  const [items, reservationGroups, fbaReservationGroups, wholesaleReservationGroups, costRows] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: {
        ...(productId   ? { productId } : {}),
        ...(locationId  ? { locationId } : {}),
        ...(warehouseId ? { location: { warehouseId } } : {}),
        ...(gradeId === 'none' ? { gradeId: null } : gradeId ? { gradeId } : {}),
        ...(search
          ? {
              OR: [
                { product: { description: { contains: search, mode: 'insensitive' } } },
                { product: { sku: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        product:  { select: { id: true, description: true, sku: true, isSerializable: true,
          marketplaceSkus: { select: { marketplace: true, gradeId: true, sellerSku: true } }
        } },
        location: { include: { warehouse: { select: { id: true, name: true } } } },
        grade:    { select: { id: true, grade: true, description: true } },
      },
      orderBy: [
        { location: { warehouse: { name: 'asc' } } },
        { location: { name: 'asc' } },
        { product: { description: 'asc' } },
        { grade: { sortOrder: 'asc' } },
      ],
    }),
    prisma.orderInventoryReservation.groupBy({
      by: ['productId', 'locationId', 'gradeId'],
      where: {
        order: { workflowStatus: { in: ['PROCESSING', 'AWAITING_VERIFICATION'] } },
      },
      _sum: { qtyReserved: true },
    }),
    // FBA reservations for shipments not yet shipped or cancelled
    prisma.fbaInventoryReservation.groupBy({
      by: ['productId', 'locationId', 'gradeId'],
      where: {
        fbaShipment: { status: { notIn: ['SHIPPED', 'CANCELLED'] } },
      },
      _sum: { qtyReserved: true },
    }),
    // Wholesale soft reservations (qty NOT decremented — only decremented on ship)
    prisma.salesOrderInventoryReservation.groupBy({
      by: ['productId', 'locationId', 'gradeId'],
      where: {
        salesOrder: { fulfillmentStatus: { in: ['PROCESSING'] } },
      },
      _sum: { qtyReserved: true },
    }),
    // Latest unit cost per product+grade from PO lines
    prisma.$queryRaw<{ productId: string; gradeId: string | null; unitCost: number }[]>`
      SELECT DISTINCT ON ("productId", "gradeId")
        "productId", "gradeId", "unitCost"::float8 as "unitCost"
      FROM purchase_order_lines
      ORDER BY "productId", "gradeId", "createdAt" DESC
    `,
  ])

  // Build lookup: `${productId}:${locationId}:${gradeId ?? ''}` → reserved qty
  // Hard reservations (Amazon + FBA) — qty was already decremented in inventoryItem.qty
  const hardReservedMap = new Map<string, number>()
  for (const r of reservationGroups) {
    const key = `${r.productId}:${r.locationId}:${r.gradeId ?? ''}`
    hardReservedMap.set(key, (hardReservedMap.get(key) ?? 0) + (r._sum.qtyReserved ?? 0))
  }
  for (const r of fbaReservationGroups) {
    const key = `${r.productId}:${r.locationId}:${r.gradeId ?? ''}`
    hardReservedMap.set(key, (hardReservedMap.get(key) ?? 0) + (r._sum.qtyReserved ?? 0))
  }
  // Wholesale soft reservations — qty NOT decremented, only reserved until shipped
  const wholesaleReservedMap = new Map<string, number>()
  for (const r of wholesaleReservationGroups) {
    const key = `${r.productId}:${r.locationId}:${r.gradeId ?? ''}`
    wholesaleReservedMap.set(key, (wholesaleReservedMap.get(key) ?? 0) + (r._sum.qtyReserved ?? 0))
  }

  // Build lookup: `${productId}:${gradeId ?? ''}` → latest unit cost
  const costMap = new Map<string, number>()
  const costProductOnly = new Map<string, number>() // fallback ignoring grade
  for (const c of costRows) {
    costMap.set(`${c.productId}:${c.gradeId ?? ''}`, c.unitCost)
    if (!costProductOnly.has(c.productId)) {
      costProductOnly.set(c.productId, c.unitCost)
    }
  }

  // Batch lookup fulfillment channels for amazon marketplace SKUs
  const allSellerSkus = new Set<string>()
  for (const item of items) {
    for (const ms of item.product.marketplaceSkus ?? []) {
      if (ms.marketplace === 'amazon' && ms.sellerSku) allSellerSkus.add(ms.sellerSku)
    }
  }
  const fcListings = allSellerSkus.size > 0
    ? await prisma.sellerListing.findMany({
        where: { sku: { in: Array.from(allSellerSkus) } },
        select: { sku: true, fulfillmentChannel: true },
        distinct: ['sku'],
      })
    : []
  const fcMap = new Map(fcListings.map(l => [l.sku, l.fulfillmentChannel]))

  const data = items
    .map(item => {
      const key      = `${item.productId}:${item.locationId}:${item.gradeId ?? ''}`
      const hardReserved      = hardReservedMap.get(key) ?? 0
      const wholesaleReserved = wholesaleReservedMap.get(key) ?? 0
      const onHand   = item.qty + hardReserved          // qty has hard-reserves subtracted
      const reserved = hardReserved + wholesaleReserved  // total committed to orders
      const unitCost = costMap.get(`${item.productId}:${item.gradeId ?? ''}`) ?? costProductOnly.get(item.productId) ?? null
      // Enrich marketplaceSkus with fulfillmentChannel
      const product = {
        ...item.product,
        marketplaceSkus: (item.product.marketplaceSkus ?? []).map(ms => ({
          ...ms,
          fulfillmentChannel: ms.marketplace === 'amazon' ? (fcMap.get(ms.sellerSku) ?? null) : null,
        })),
      }
      return { ...item, product, reserved, onHand, unitCost }
    })
    .filter(item => item.onHand > 0 || item.reserved > 0)

  return NextResponse.json({ data })
}
