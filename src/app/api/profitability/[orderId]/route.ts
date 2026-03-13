/**
 * GET /api/profitability/:orderId?source=amazon|backmarket|wholesale
 *
 * Returns per-line-item profitability breakdown for a single order.
 * COGS is derived from the actual serial sold (serial → receipt → PO line cost),
 * with fallback to SKU mapping for non-serialized items.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { Prisma } from '@prisma/client'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params
  const source = req.nextUrl.searchParams.get('source') ?? 'amazon'

  // ── Fallback COGS map ─────────────────────────────────────────────────
  const cogsRows = await prisma.$queryRaw<
    { productId: string; gradeId: string | null; unitCost: number }[]
  >(Prisma.sql`
    SELECT DISTINCT ON ("productId", "gradeId")
      "productId", "gradeId", "unitCost"::float8 as "unitCost"
    FROM purchase_order_lines
    ORDER BY "productId", "gradeId", "createdAt" DESC
  `)
  const cogsMap = new Map<string, number>()
  const cogsProductOnly = new Map<string, number>()
  for (const row of cogsRows) {
    cogsMap.set(`${row.productId}:${row.gradeId ?? ''}`, row.unitCost)
    if (!cogsProductOnly.has(row.productId)) cogsProductOnly.set(row.productId, row.unitCost)
  }

  // ── Fallback cost code map ────────────────────────────────────────────
  const costCodeRows = await prisma.$queryRaw<
    { productId: string; gradeId: string | null; amount: number }[]
  >(Prisma.sql`
    SELECT DISTINCT ON (pol."productId", pol."gradeId")
      pol."productId", pol."gradeId", cc."amount"::float8 as "amount"
    FROM purchase_order_lines pol
    JOIN cost_codes cc ON cc.id = pol."costCodeId"
    WHERE pol."costCodeId" IS NOT NULL
    ORDER BY pol."productId", pol."gradeId", pol."createdAt" DESC
  `)
  const costCodeMap = new Map<string, number>()
  const costCodeProductOnly = new Map<string, number>()
  for (const row of costCodeRows) {
    costCodeMap.set(`${row.productId}:${row.gradeId ?? ''}`, row.amount)
    if (!costCodeProductOnly.has(row.productId)) costCodeProductOnly.set(row.productId, row.amount)
  }

  // ── SKU → product+grade mapping (for non-serialized fallback) ─────────
  const skuMap = new Map<string, { productId: string; gradeId: string | null }>()
  const allProducts = await prisma.product.findMany({ select: { id: true, sku: true } })
  for (const p of allProducts) skuMap.set(p.sku, { productId: p.id, gradeId: null })
  const mskuRows = await prisma.productGradeMarketplaceSku.findMany({
    select: { sellerSku: true, productId: true, gradeId: true },
  })
  for (const m of mskuRows) skuMap.set(m.sellerSku, { productId: m.productId, gradeId: m.gradeId })

  if (source === 'wholesale') {
    return handleWholesale(orderId, cogsMap, cogsProductOnly, costCodeMap, costCodeProductOnly)
  }

  return handleMarketplace(orderId, cogsMap, cogsProductOnly, costCodeMap, costCodeProductOnly, skuMap)
}

async function handleMarketplace(
  orderId: string,
  cogsMap: Map<string, number>,
  cogsProductOnly: Map<string, number>,
  costCodeMap: Map<string, number>,
  costCodeProductOnly: Map<string, number>,
  skuMap: Map<string, { productId: string; gradeId: string | null }>,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      label: { select: { shipmentCost: true } },
      serialAssignments: {
        include: {
          inventorySerial: {
            select: {
              productId: true,
              gradeId: true,
              receiptLine: {
                select: {
                  purchaseOrderLine: {
                    select: {
                      unitCost: true,
                      costCode: { select: { amount: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const totalCommission = Number(order.marketplaceCommission ?? 0)
  const totalShipping = Number(order.label?.shipmentCost ?? 0)

  // Build serial cost map keyed by orderItemId
  const serialCostsByItem = new Map<string, { cogs: number; cc: number; count: number }>()
  for (const sa of order.serialAssignments) {
    const serial = sa.inventorySerial
    const polCost = serial.receiptLine?.purchaseOrderLine
    const existing = serialCostsByItem.get(sa.orderItemId) ?? { cogs: 0, cc: 0, count: 0 }
    if (polCost) {
      existing.cogs += Number(polCost.unitCost)
      existing.cc += polCost.costCode ? Number(polCost.costCode.amount) : 0
    } else {
      const key = `${serial.productId}:${serial.gradeId ?? ''}`
      existing.cogs += cogsMap.get(key) ?? cogsProductOnly.get(serial.productId) ?? 0
      existing.cc += costCodeMap.get(key) ?? costCodeProductOnly.get(serial.productId) ?? 0
    }
    existing.count += 1
    serialCostsByItem.set(sa.orderItemId, existing)
  }

  const totalSale = order.items.reduce((sum, item) => sum + Number(item.itemPrice ?? 0), 0)

  const lineItems = order.items.map((item) => {
    const itemSale = Number(item.itemPrice ?? 0)
    const proportion = totalSale > 0 ? itemSale / totalSale : 0

    let itemCogs = 0
    let itemCostCodes = 0
    const serialCosts = serialCostsByItem.get(item.id)
    if (serialCosts && serialCosts.count > 0) {
      itemCogs = serialCosts.cogs
      itemCostCodes = serialCosts.cc
    } else {
      const mapping = item.sellerSku ? skuMap.get(item.sellerSku) : null
      if (mapping) {
        const key = `${mapping.productId}:${mapping.gradeId ?? ''}`
        itemCogs = (cogsMap.get(key) ?? cogsProductOnly.get(mapping.productId) ?? 0) * item.quantityOrdered
        itemCostCodes = (costCodeMap.get(key) ?? costCodeProductOnly.get(mapping.productId) ?? 0) * item.quantityOrdered
      }
    }

    const itemCommission = totalCommission * proportion
    const itemShipping = totalShipping * proportion
    const itemNetProfit = itemSale - itemCogs - itemCommission - itemShipping - itemCostCodes

    return {
      id: item.id,
      orderItemId: item.orderItemId,
      asin: item.asin,
      sellerSku: item.sellerSku,
      title: item.title,
      quantity: item.quantityOrdered,
      saleValue: Math.round(itemSale * 100) / 100,
      cogs: Math.round(itemCogs * 100) / 100,
      commission: Math.round(itemCommission * 100) / 100,
      shipping: Math.round(itemShipping * 100) / 100,
      costCodeDeductions: Math.round(itemCostCodes * 100) / 100,
      netProfit: Math.round(itemNetProfit * 100) / 100,
    }
  })

  return NextResponse.json({ lineItems })
}

async function handleWholesale(
  orderId: string,
  cogsMap: Map<string, number>,
  cogsProductOnly: Map<string, number>,
  costCodeMap: Map<string, number>,
  costCodeProductOnly: Map<string, number>,
) {
  const order = await prisma.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      serialAssignments: {
        include: {
          inventorySerial: {
            select: {
              productId: true,
              gradeId: true,
              receiptLine: {
                select: {
                  purchaseOrderLine: {
                    select: {
                      unitCost: true,
                      costCode: { select: { amount: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const orderTotal = Number(order.total ?? 0)
  const totalShipping = Number(order.shippingCost ?? 0)

  // Build serial cost map keyed by salesOrderItemId
  const serialCostsByItem = new Map<string, { cogs: number; cc: number; count: number }>()
  for (const sa of order.serialAssignments) {
    const serial = sa.inventorySerial
    const polCost = serial.receiptLine?.purchaseOrderLine
    const itemId = sa.salesOrderItemId ?? ''
    const existing = serialCostsByItem.get(itemId) ?? { cogs: 0, cc: 0, count: 0 }
    if (polCost) {
      existing.cogs += Number(polCost.unitCost)
      existing.cc += polCost.costCode ? Number(polCost.costCode.amount) : 0
    } else {
      const key = `${serial.productId}:${serial.gradeId ?? ''}`
      existing.cogs += cogsMap.get(key) ?? cogsProductOnly.get(serial.productId) ?? 0
      existing.cc += costCodeMap.get(key) ?? costCodeProductOnly.get(serial.productId) ?? 0
    }
    existing.count += 1
    serialCostsByItem.set(itemId, existing)
  }

  const lineItems = order.items.map((item) => {
    const itemSale = Number(item.total ?? 0)
    const proportion = orderTotal > 0 ? itemSale / orderTotal : 0

    let itemCogs = 0
    let itemCostCodes = 0
    const serialCosts = serialCostsByItem.get(item.id)
    if (serialCosts && serialCosts.count > 0) {
      itemCogs = serialCosts.cogs
      itemCostCodes = serialCosts.cc
    } else if (item.productId) {
      const key = `${item.productId}:`
      itemCogs = (cogsMap.get(key) ?? cogsProductOnly.get(item.productId) ?? 0) * Number(item.quantity)
      itemCostCodes = (costCodeMap.get(key) ?? costCodeProductOnly.get(item.productId) ?? 0) * Number(item.quantity)
    }

    const itemShipping = totalShipping * proportion
    const itemNetProfit = itemSale - itemCogs - itemShipping - itemCostCodes

    return {
      id: item.id,
      orderItemId: item.id,
      asin: null,
      sellerSku: item.sku,
      title: item.title,
      quantity: Number(item.quantity),
      saleValue: Math.round(itemSale * 100) / 100,
      cogs: Math.round(itemCogs * 100) / 100,
      commission: 0,
      shipping: Math.round(itemShipping * 100) / 100,
      costCodeDeductions: Math.round(itemCostCodes * 100) / 100,
      netProfit: Math.round(itemNetProfit * 100) / 100,
    }
  })

  return NextResponse.json({ lineItems })
}
