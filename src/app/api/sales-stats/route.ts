/**
 * GET /api/sales-stats
 *
 * Per-SKU sales statistics across all channels (Amazon, BackMarket, Wholesale).
 * Uses same COGS/profit calculations as profitability report.
 *
 * Query params: startDate, endDate, channel, customerId, sku, includeFba
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { Prisma } from '@prisma/client'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const channel = searchParams.get('channel') || 'all'
  const customerId = searchParams.get('customerId') || ''
  const skuFilter = searchParams.get('sku')?.trim().toLowerCase() || ''
  const includeFba = searchParams.get('includeFba') === 'true'

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  const dateFrom = new Date(startDate + 'T00:00:00Z')
  const dateTo = new Date(endDate + 'T23:59:59.999Z')

  // ── Fallback COGS lookup: latest unit cost per product+grade ──────────
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
    if (!cogsProductOnly.has(row.productId)) {
      cogsProductOnly.set(row.productId, row.unitCost)
    }
  }

  // ── Fallback cost code lookup ─────────────────────────────────────────
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
    if (!costCodeProductOnly.has(row.productId)) {
      costCodeProductOnly.set(row.productId, row.amount)
    }
  }

  // ── SKU → product+grade mapping ────────────────────────────────────────
  const skuMap = new Map<string, { productId: string; gradeId: string | null }>()
  const allProducts = await prisma.product.findMany({ select: { id: true, sku: true } })
  for (const p of allProducts) skuMap.set(p.sku, { productId: p.id, gradeId: null })
  const mskuRows = await prisma.productGradeMarketplaceSku.findMany({
    select: { sellerSku: true, productId: true, gradeId: true },
  })
  for (const m of mskuRows) skuMap.set(m.sellerSku, { productId: m.productId, gradeId: m.gradeId })

  // ── Helper: resolve COGS + cost-code for a serial assignment ──────────
  function resolveSerialCost(sa: {
    orderItemId: string
    inventorySerial: {
      productId: string
      gradeId: string | null
      unitCost: unknown
      receiptLine: {
        purchaseOrderLine: {
          unitCost: unknown
          costCode: { amount: unknown } | null
        }
      } | null
    }
  }) {
    const serial = sa.inventorySerial
    const polCost = serial.receiptLine?.purchaseOrderLine
    if (polCost) {
      return {
        orderItemId: sa.orderItemId,
        unitCost: Number(polCost.unitCost),
        costCodeAmount: polCost.costCode ? Number(polCost.costCode.amount) : 0,
      }
    }
    if (serial.unitCost != null && Number(serial.unitCost) > 0) {
      return {
        orderItemId: sa.orderItemId,
        unitCost: Number(serial.unitCost),
        costCodeAmount: 0,
      }
    }
    const key = `${serial.productId}:${serial.gradeId ?? ''}`
    return {
      orderItemId: sa.orderItemId,
      unitCost: cogsMap.get(key) ?? cogsProductOnly.get(serial.productId) ?? 0,
      costCodeAmount: costCodeMap.get(key) ?? costCodeProductOnly.get(serial.productId) ?? 0,
    }
  }

  const serialAssignmentInclude = {
    include: {
      inventorySerial: {
        select: {
          productId: true,
          gradeId: true,
          unitCost: true,
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
  } as const

  // ── Per-SKU aggregation map ───────────────────────────────────────────
  type SkuBucket = {
    sku: string
    title: string
    sources: Set<string>
    unitsSold: number
    revenue: number
    cogs: number
    commission: number
    shipping: number
    costCodes: number
  }
  const skuBuckets = new Map<string, SkuBucket>()

  function getOrCreateBucket(sku: string, title: string, source: string): SkuBucket {
    let bucket = skuBuckets.get(sku)
    if (!bucket) {
      bucket = { sku, title, sources: new Set(), unitsSold: 0, revenue: 0, cogs: 0, commission: 0, shipping: 0, costCodes: 0 }
      skuBuckets.set(sku, bucket)
    }
    bucket.sources.add(source)
    if (!bucket.title && title) bucket.title = title
    return bucket
  }

  // ── Fetch marketplace orders ──────────────────────────────────────────
  const wantMarketplace = channel === 'all' || channel === 'amazon' || channel === 'backmarket'
  if (wantMarketplace) {
    const marketplaceWhere: Prisma.OrderWhereInput = {
      workflowStatus: 'SHIPPED',
      ...(!includeFba ? { fulfillmentChannel: { not: 'AFN' } } : {}),
      OR: [
        { shippedAt: { gte: dateFrom, lte: dateTo } },
        { shippedAt: null, purchaseDate: { gte: dateFrom, lte: dateTo } },
      ],
    }
    if (channel === 'amazon') marketplaceWhere.orderSource = 'amazon'
    if (channel === 'backmarket') marketplaceWhere.orderSource = 'backmarket'

    const marketplaceOrders = await prisma.order.findMany({
      where: marketplaceWhere,
      include: {
        items: true,
        label: { select: { shipmentCost: true } },
        serialAssignments: serialAssignmentInclude,
      },
    })

    // Batch-resolve BackMarket bmSerials costs
    const allBmSerialNumbers: string[] = []
    for (const order of marketplaceOrders) {
      if (order.orderSource !== 'backmarket') continue
      for (const item of order.items) {
        const serials = item.bmSerials as string[] | null
        if (serials?.length) allBmSerialNumbers.push(...serials)
      }
    }
    const bmSerialCostMap = new Map<string, { unitCost: number; costCodeAmount: number }>()
    if (allBmSerialNumbers.length > 0) {
      const bmSerials = await prisma.inventorySerial.findMany({
        where: { serialNumber: { in: allBmSerialNumbers } },
        select: {
          serialNumber: true,
          productId: true,
          gradeId: true,
          unitCost: true,
          receiptLine: {
            select: {
              purchaseOrderLine: {
                select: { unitCost: true, costCode: { select: { amount: true } } },
              },
            },
          },
        },
      })
      for (const s of bmSerials) {
        const pol = s.receiptLine?.purchaseOrderLine
        const key = `${s.productId}:${s.gradeId ?? ''}`
        let resolvedCost: number
        let resolvedCC: number
        if (pol) {
          resolvedCost = Number(pol.unitCost)
          resolvedCC = pol.costCode ? Number(pol.costCode.amount) : 0
        } else if (s.unitCost != null && Number(s.unitCost) > 0) {
          resolvedCost = Number(s.unitCost)
          resolvedCC = 0
        } else {
          resolvedCost = cogsMap.get(key) ?? cogsProductOnly.get(s.productId) ?? 0
          resolvedCC = costCodeMap.get(key) ?? costCodeProductOnly.get(s.productId) ?? 0
        }
        bmSerialCostMap.set(s.serialNumber, { unitCost: resolvedCost, costCodeAmount: resolvedCC })
      }
    }

    // Process marketplace orders into SKU buckets
    for (const order of marketplaceOrders) {
      const isRepl = order.isReplacement === true
      const totalCommission = Number(order.marketplaceCommission ?? 0)
      const totalShipping = Number(order.label?.shipmentCost ?? order.manualShipCost ?? 0)

      const serialCostsByItem = new Map<string, { cogs: number; cc: number; count: number }>()
      for (const sa of order.serialAssignments) {
        const sc = resolveSerialCost(sa)
        const existing = serialCostsByItem.get(sc.orderItemId) ?? { cogs: 0, cc: 0, count: 0 }
        existing.cogs += sc.unitCost
        existing.cc += sc.costCodeAmount
        existing.count += 1
        serialCostsByItem.set(sc.orderItemId, existing)
      }

      const totalSale = order.items.reduce((sum, item) => sum + Number(item.itemPrice ?? 0), 0)

      for (const item of order.items) {
        const sku = item.sellerSku || item.asin || 'UNKNOWN'
        const title = item.title || ''
        const bucket = getOrCreateBucket(sku, title, order.orderSource)

        const qty = item.quantityOrdered
        bucket.unitsSold += qty

        if (isRepl) continue // count units but $0 financials

        const itemSale = Number(item.itemPrice ?? 0) + Number(item.shippingPrice ?? 0)
        const proportion = totalSale > 0 ? Number(item.itemPrice ?? 0) / totalSale : 0

        let itemCogs = 0
        let itemCostCodes = 0
        const serialCosts = serialCostsByItem.get(item.id)
        if (serialCosts && serialCosts.count > 0) {
          itemCogs = serialCosts.cogs
          itemCostCodes = serialCosts.cc
        } else {
          const bmSerials = item.bmSerials as string[] | null
          if (bmSerials?.length) {
            for (const sn of bmSerials) {
              const sc = bmSerialCostMap.get(sn)
              if (sc) {
                itemCogs += sc.unitCost
                itemCostCodes += sc.costCodeAmount
              }
            }
          } else {
            const mapping = item.sellerSku ? skuMap.get(item.sellerSku) : null
            if (mapping) {
              const key = `${mapping.productId}:${mapping.gradeId ?? ''}`
              itemCogs = (cogsMap.get(key) ?? cogsProductOnly.get(mapping.productId) ?? 0) * qty
              itemCostCodes = (costCodeMap.get(key) ?? costCodeProductOnly.get(mapping.productId) ?? 0) * qty
            }
          }
        }

        bucket.revenue += itemSale
        bucket.cogs += itemCogs
        bucket.commission += totalCommission * proportion
        bucket.shipping += totalShipping * proportion
        bucket.costCodes += itemCostCodes
      }
    }
  }

  // ── Fetch wholesale orders ────────────────────────────────────────────
  const wantWholesale = channel === 'all' || channel === 'wholesale'
  if (wantWholesale) {
    const wholesaleWhere: Prisma.SalesOrderWhereInput = {
      fulfillmentStatus: 'SHIPPED',
      OR: [
        { shippedAt: { gte: dateFrom, lte: dateTo } },
        { shippedAt: null, orderDate: { gte: dateFrom, lte: dateTo } },
      ],
    }
    if (customerId) wholesaleWhere.customerId = customerId

    const wholesaleOrders = await prisma.salesOrder.findMany({
      where: wholesaleWhere,
      include: {
        items: true,
        serialAssignments: {
          include: {
            inventorySerial: {
              select: {
                productId: true,
                gradeId: true,
                unitCost: true,
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

    for (const order of wholesaleOrders) {
      const orderTotal = Number(order.total ?? 0)
      const totalShipping = Number(order.shippingCost ?? 0)

      const serialCostsByItem = new Map<string, { cogs: number; cc: number; count: number }>()
      for (const sa of order.serialAssignments) {
        const serial = sa.inventorySerial
        const polCost = serial.receiptLine?.purchaseOrderLine
        const itemId = sa.salesOrderItemId ?? ''
        const existing = serialCostsByItem.get(itemId) ?? { cogs: 0, cc: 0, count: 0 }
        if (polCost) {
          existing.cogs += Number(polCost.unitCost)
          existing.cc += polCost.costCode ? Number(polCost.costCode.amount) : 0
        } else if (serial.unitCost != null && Number(serial.unitCost) > 0) {
          existing.cogs += Number(serial.unitCost)
        } else {
          const key = `${serial.productId}:${serial.gradeId ?? ''}`
          existing.cogs += cogsMap.get(key) ?? cogsProductOnly.get(serial.productId) ?? 0
          existing.cc += costCodeMap.get(key) ?? costCodeProductOnly.get(serial.productId) ?? 0
        }
        existing.count += 1
        serialCostsByItem.set(itemId, existing)
      }

      for (const item of order.items) {
        const sku = item.sku || 'UNKNOWN'
        const title = item.title || ''
        const bucket = getOrCreateBucket(sku, title, 'wholesale')

        const qty = Number(item.quantity)
        bucket.unitsSold += qty

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
          itemCogs = (cogsMap.get(key) ?? cogsProductOnly.get(item.productId) ?? 0) * qty
          itemCostCodes = (costCodeMap.get(key) ?? costCodeProductOnly.get(item.productId) ?? 0) * qty
        }

        bucket.revenue += itemSale
        bucket.cogs += itemCogs
        bucket.commission += 0
        bucket.shipping += totalShipping * proportion
        bucket.costCodes += itemCostCodes
      }
    }
  }

  // ── Build output rows ─────────────────────────────────────────────────
  let rows = Array.from(skuBuckets.values()).map((b) => {
    const profit = b.revenue - b.cogs - b.commission - b.shipping - b.costCodes
    const margin = b.revenue > 0 ? (profit / b.revenue) * 100 : 0
    const sources = Array.from(b.sources)
    return {
      sku: b.sku,
      title: b.title,
      channel: sources.length === 1 ? sources[0] : 'mixed',
      unitsSold: b.unitsSold,
      revenue: Math.round(b.revenue * 100) / 100,
      cogs: Math.round(b.cogs * 100) / 100,
      commission: Math.round(b.commission * 100) / 100,
      shipping: Math.round(b.shipping * 100) / 100,
      costCodes: Math.round(b.costCodes * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      margin: Math.round(margin * 10) / 10,
    }
  })

  // Apply SKU filter (partial match)
  if (skuFilter) {
    rows = rows.filter((r) => r.sku.toLowerCase().includes(skuFilter))
  }

  // Sort by revenue desc
  rows.sort((a, b) => b.revenue - a.revenue)

  // Summary
  const summary = {
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    unitsSold: rows.reduce((s, r) => s + r.unitsSold, 0),
    cogs: rows.reduce((s, r) => s + r.cogs, 0),
    commission: rows.reduce((s, r) => s + r.commission, 0),
    shipping: rows.reduce((s, r) => s + r.shipping, 0),
    costCodes: rows.reduce((s, r) => s + r.costCodes, 0),
    profit: rows.reduce((s, r) => s + r.profit, 0),
  }

  return NextResponse.json({ summary, rows })
}
