import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
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
  const agedFg      = searchParams.get('agedFg') === 'true'

  // When agedFg is active, find serials whose last move to FG was >30 days ago
  let agedFilter: Prisma.InventoryItemWhereInput | undefined
  if (agedFg) {
    const fgLocations = await prisma.location.findMany({
      where: { isFinishedGoods: true },
      select: { id: true },
    })
    const fgLocationIds = fgLocations.map(l => l.id)

    if (fgLocationIds.length === 0) {
      return NextResponse.json({ data: [] })
    }

    // Find serials currently IN_STOCK at FG whose last move to FG was >30 days ago
    const agedSerials = await prisma.$queryRaw<
      { productId: string; locationId: string; gradeId: string | null }[]
    >`
      SELECT DISTINCT s."productId", s."locationId", s."gradeId"
      FROM inventory_serials s
      INNER JOIN (
        SELECT "inventorySerialId", MAX("createdAt") AS last_fg_move
        FROM serial_history
        WHERE "locationId" = ANY(${fgLocationIds}::text[])
          AND "eventType" IN ('LOCATION_MOVE', 'PO_RECEIPT', 'MP_RMA_RETURN', 'FBA_RETURN', 'WHOLESALE_RMA_RETURN')
        GROUP BY "inventorySerialId"
      ) sh ON s.id = sh."inventorySerialId"
      WHERE s.status = 'IN_STOCK'
        AND s."locationId" = ANY(${fgLocationIds}::text[])
        AND sh.last_fg_move < NOW() - INTERVAL '30 days'
    `

    if (agedSerials.length === 0) {
      return NextResponse.json({ data: [] })
    }

    // Build OR conditions for matching inventory items
    agedFilter = {
      OR: agedSerials.map(s => ({
        productId: s.productId,
        locationId: s.locationId,
        gradeId: s.gradeId,
      })),
    }
  }

  const [items, reservationGroups, fbaReservationGroups, wholesaleReservationGroups, costRows, serialCostRows] = await Promise.all([
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
        ...(agedFilter ? agedFilter : {}),
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
    // Fallback: avg unit cost from inventory_serials (covers migrations + direct receives)
    prisma.$queryRaw<{ productId: string; gradeId: string | null; avgCost: number }[]>`
      SELECT "productId", "gradeId", AVG("unitCost")::float8 as "avgCost"
      FROM inventory_serials
      WHERE "unitCost" IS NOT NULL AND status = 'IN_STOCK'
      GROUP BY "productId", "gradeId"
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
  // Fallback cost from serial-level unitCost (migrations, direct receives)
  const serialCostMap = new Map<string, number>()
  const serialCostProductOnly = new Map<string, number>()
  for (const c of serialCostRows) {
    serialCostMap.set(`${c.productId}:${c.gradeId ?? ''}`, c.avgCost)
    if (!serialCostProductOnly.has(c.productId)) {
      serialCostProductOnly.set(c.productId, c.avgCost)
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
      const costKey = `${item.productId}:${item.gradeId ?? ''}`
      const unitCost = costMap.get(costKey) ?? costProductOnly.get(item.productId)
        ?? serialCostMap.get(costKey) ?? serialCostProductOnly.get(item.productId) ?? null
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
