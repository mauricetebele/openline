/**
 * GET /api/profitability
 *
 * Returns profitability breakdown for shipped orders in date range.
 * Combines marketplace orders (Amazon/BackMarket) and wholesale (SalesOrder).
 *
 * COGS is determined from the actual serial sold:
 *   Serial → POReceiptLine → PurchaseOrderLine.unitCost
 * Falls back to latest PO-line cost per product+grade for non-serialized items
 * or serials without a receipt link.
 *
 * Query params: startDate, endDate, page (default 1), pageSize (default 50),
 *               view ('order' | 'lineItem'), search (text filter)
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
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get('pageSize') ?? '50', 10)))
  const view = searchParams.get('view') ?? 'order'     // 'order' | 'lineItem'
  const search = searchParams.get('search')?.trim().toLowerCase() || ''

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

  // ── SKU → product+grade mapping (for non-serialized items) ────────────
  const skuMap = new Map<string, { productId: string; gradeId: string | null }>()
  const allProducts = await prisma.product.findMany({ select: { id: true, sku: true } })
  for (const p of allProducts) skuMap.set(p.sku, { productId: p.id, gradeId: null })
  const mskuRows = await prisma.productGradeMarketplaceSku.findMany({
    select: { sellerSku: true, productId: true, gradeId: true },
  })
  for (const m of mskuRows) skuMap.set(m.sellerSku, { productId: m.productId, gradeId: m.gradeId })

  // ── Helper: resolve COGS + cost-code for a single serial assignment ───
  type SerialAssignmentWithCost = {
    orderItemId: string
    unitCost: number
    costCodeAmount: number
  }

  function resolveSerialCost(sa: {
    orderItemId: string
    inventorySerial: {
      productId: string
      gradeId: string | null
      receiptLine: {
        purchaseOrderLine: {
          unitCost: unknown
          costCode: { amount: unknown } | null
        }
      } | null
    }
  }): SerialAssignmentWithCost {
    const serial = sa.inventorySerial
    const polCost = serial.receiptLine?.purchaseOrderLine
    if (polCost) {
      return {
        orderItemId: sa.orderItemId,
        unitCost: Number(polCost.unitCost),
        costCodeAmount: polCost.costCode ? Number(polCost.costCode.amount) : 0,
      }
    }
    // Fallback: use latest PO line cost for this product+grade
    const key = `${serial.productId}:${serial.gradeId ?? ''}`
    return {
      orderItemId: sa.orderItemId,
      unitCost: cogsMap.get(key) ?? cogsProductOnly.get(serial.productId) ?? 0,
      costCodeAmount: costCodeMap.get(key) ?? costCodeProductOnly.get(serial.productId) ?? 0,
    }
  }

  // Serial assignment include shape (reused for marketplace + line-item queries)
  const serialAssignmentInclude = {
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
  } as const

  // ── Marketplace orders (SHIPPED) ────────────────────────────────────────
  const marketplaceWhere = {
    workflowStatus: 'SHIPPED' as const,
    OR: [
      { shippedAt: { gte: dateFrom, lte: dateTo } },
      { shippedAt: null, purchaseDate: { gte: dateFrom, lte: dateTo } },
    ],
  }

  const [marketplaceOrders, marketplaceCount] = await Promise.all([
    prisma.order.findMany({
      where: marketplaceWhere,
      include: {
        items: true,
        label: { select: { shipmentCost: true } },
        serialAssignments: serialAssignmentInclude,
      },
      orderBy: { purchaseDate: 'desc' },
    }),
    prisma.order.count({ where: marketplaceWhere }),
  ])

  // ── Wholesale orders (SHIPPED) ─────────────────────────────────────────
  const wholesaleWhere = {
    fulfillmentStatus: 'SHIPPED' as const,
    OR: [
      { shippedAt: { gte: dateFrom, lte: dateTo } },
      { shippedAt: null, orderDate: { gte: dateFrom, lte: dateTo } },
    ],
  }

  const [wholesaleOrders, wholesaleCount] = await Promise.all([
    prisma.salesOrder.findMany({
      where: wholesaleWhere,
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
      orderBy: { orderDate: 'desc' },
    }),
    prisma.salesOrder.count({ where: wholesaleWhere }),
  ])

  // ── Build unified rows ─────────────────────────────────────────────────
  type ProfitRow = {
    id: string
    olmNumber: number | null
    marketplaceOrderId: string
    source: string
    orderDate: string
    saleValue: number
    totalCogs: number
    commission: number
    customerShipping: number
    shippingCost: number
    costCodeDeductions: number
    netProfit: number
    commissionSynced: boolean
  }

  const rows: ProfitRow[] = []

  // ── Batch-resolve BackMarket bmSerials costs ─────────────────────────
  // BackMarket orders store shipped serials in bmSerials[] instead of
  // order_serial_assignments, so we resolve their PO costs here.
  const allBmSerialNumbers: string[] = []
  for (const order of marketplaceOrders) {
    if (order.orderSource !== 'backmarket') continue
    for (const item of order.items) {
      const serials = item.bmSerials as string[] | null
      if (serials?.length) allBmSerialNumbers.push(...serials)
    }
  }
  const bmSerialCostMap = new Map<string, { unitCost: number; costCodeAmount: number; productId: string; gradeId: string | null }>()
  if (allBmSerialNumbers.length > 0) {
    const bmSerials = await prisma.inventorySerial.findMany({
      where: { serialNumber: { in: allBmSerialNumbers } },
      select: {
        serialNumber: true,
        productId: true,
        gradeId: true,
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
      bmSerialCostMap.set(s.serialNumber, {
        unitCost: pol ? Number(pol.unitCost) : (cogsMap.get(key) ?? cogsProductOnly.get(s.productId) ?? 0),
        costCodeAmount: pol?.costCode ? Number(pol.costCode.amount) : (costCodeMap.get(key) ?? costCodeProductOnly.get(s.productId) ?? 0),
        productId: s.productId,
        gradeId: s.gradeId,
      })
    }
  }

  // ── Marketplace rows ──────────────────────────────────────────────────
  for (const order of marketplaceOrders) {
    const saleValue = order.items.reduce((sum, item) => sum + Number(item.itemPrice ?? 0), 0)
    const customerShipping = order.items.reduce((sum, item) => sum + Number(item.shippingPrice ?? 0), 0)
    const shippingCost = Number(order.label?.shipmentCost ?? order.manualShipCost ?? 0)
    const commission = Number(order.marketplaceCommission ?? 0)
    const commissionSynced = !!order.commissionSyncedAt

    // COGS from serial assignments (actual cost of the serial sold)
    let totalCogs = 0
    let costCodeDeductions = 0
    const serialCostsByItem = new Map<string, { cogs: number; cc: number; count: number }>()
    for (const sa of order.serialAssignments) {
      const sc = resolveSerialCost(sa)
      const existing = serialCostsByItem.get(sc.orderItemId) ?? { cogs: 0, cc: 0, count: 0 }
      existing.cogs += sc.unitCost
      existing.cc += sc.costCodeAmount
      existing.count += 1
      serialCostsByItem.set(sc.orderItemId, existing)
    }

    for (const item of order.items) {
      const serialCosts = serialCostsByItem.get(item.id)
      if (serialCosts && serialCosts.count > 0) {
        // Serialized: use actual serial costs
        totalCogs += serialCosts.cogs
        costCodeDeductions += serialCosts.cc
      } else {
        // BackMarket: resolve cost from bmSerials
        const bmSerials = item.bmSerials as string[] | null
        if (bmSerials?.length) {
          for (const sn of bmSerials) {
            const sc = bmSerialCostMap.get(sn)
            if (sc) {
              totalCogs += sc.unitCost
              costCodeDeductions += sc.costCodeAmount
            }
          }
        } else {
          // Non-serialized: fall back to SKU mapping
          const mapping = item.sellerSku ? skuMap.get(item.sellerSku) : null
          if (mapping) {
            const key = `${mapping.productId}:${mapping.gradeId ?? ''}`
            totalCogs += (cogsMap.get(key) ?? cogsProductOnly.get(mapping.productId) ?? 0) * item.quantityOrdered
            costCodeDeductions += (costCodeMap.get(key) ?? costCodeProductOnly.get(mapping.productId) ?? 0) * item.quantityOrdered
          }
        }
      }
    }

    const netProfit = saleValue + customerShipping - totalCogs - commission - shippingCost - costCodeDeductions

    rows.push({
      id: order.id,
      olmNumber: order.olmNumber,
      marketplaceOrderId: order.amazonOrderId,
      source: order.orderSource,
      orderDate: (order.shippedAt ?? order.purchaseDate).toISOString(),
      saleValue: Math.round(saleValue * 100) / 100,
      totalCogs: Math.round(totalCogs * 100) / 100,
      commission: Math.round(commission * 100) / 100,
      customerShipping: Math.round(customerShipping * 100) / 100,
      shippingCost: Math.round(shippingCost * 100) / 100,
      costCodeDeductions: Math.round(costCodeDeductions * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      commissionSynced,
    })
  }

  // ── Wholesale rows ────────────────────────────────────────────────────
  for (const order of wholesaleOrders) {
    const saleValue = Number(order.total ?? 0)
    const shippingCost = Number(order.shippingCost ?? 0)
    const commission = 0

    let totalCogs = 0
    let costCodeDeductions = 0
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

    for (const item of order.items) {
      const serialCosts = serialCostsByItem.get(item.id)
      if (serialCosts && serialCosts.count > 0) {
        totalCogs += serialCosts.cogs
        costCodeDeductions += serialCosts.cc
      } else {
        // Non-serialized: use item product directly
        if (item.productId) {
          const key = `${item.productId}:`
          const unitCost = cogsMap.get(key) ?? cogsProductOnly.get(item.productId) ?? 0
          totalCogs += unitCost * Number(item.quantity)
          const ccAmount = costCodeMap.get(key) ?? costCodeProductOnly.get(item.productId) ?? 0
          costCodeDeductions += ccAmount * Number(item.quantity)
        }
      }
    }

    const netProfit = saleValue - totalCogs - commission - shippingCost - costCodeDeductions

    rows.push({
      id: order.id,
      olmNumber: null,
      marketplaceOrderId: order.orderNumber,
      source: 'wholesale',
      orderDate: (order.shippedAt ?? order.orderDate).toISOString(),
      saleValue,
      totalCogs: Math.round(totalCogs * 100) / 100,
      commission: 0,
      customerShipping: 0,
      shippingCost: Math.round(shippingCost * 100) / 100,
      costCodeDeductions: Math.round(costCodeDeductions * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      commissionSynced: true,
    })
  }

  // ── Line item flattening when view=lineItem ──────────────────────────
  type LineItemRow = ProfitRow & {
    orderId: string
    asin: string | null
    sellerSku: string | null
    title: string | null
    quantity: number
  }

  let finalRows: (ProfitRow | LineItemRow)[] = rows

  if (view === 'lineItem') {
    const lineItemRows: LineItemRow[] = []

    // Flatten marketplace orders
    for (const order of marketplaceOrders) {
      const totalCommissionVal = Number(order.marketplaceCommission ?? 0)
      const totalShippingVal = Number(order.label?.shipmentCost ?? order.manualShipCost ?? 0)
      const commissionSyncedVal = !!order.commissionSyncedAt

      // Build serial cost map keyed by orderItemId
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

        const itemCustomerShipping = Number(item.shippingPrice ?? 0)
        const itemCommission = totalCommissionVal * proportion
        const itemShipping = totalShippingVal * proportion
        const itemNetProfit = itemSale + itemCustomerShipping - itemCogs - itemCommission - itemShipping - itemCostCodes

        lineItemRows.push({
          id: `${order.id}:${item.id}`,
          orderId: order.id,
          olmNumber: order.olmNumber,
          marketplaceOrderId: order.amazonOrderId,
          source: order.orderSource,
          orderDate: (order.shippedAt ?? order.purchaseDate).toISOString(),
          asin: item.asin,
          sellerSku: item.sellerSku,
          title: item.title,
          quantity: item.quantityOrdered,
          saleValue: Math.round(itemSale * 100) / 100,
          totalCogs: Math.round(itemCogs * 100) / 100,
          commission: Math.round(itemCommission * 100) / 100,
          customerShipping: Math.round(itemCustomerShipping * 100) / 100,
          shippingCost: Math.round(itemShipping * 100) / 100,
          costCodeDeductions: Math.round(itemCostCodes * 100) / 100,
          netProfit: Math.round(itemNetProfit * 100) / 100,
          commissionSynced: commissionSyncedVal,
        })
      }
    }

    // Flatten wholesale orders
    for (const order of wholesaleOrders) {
      const orderTotal = Number(order.total ?? 0)
      const totalShippingVal = Number(order.shippingCost ?? 0)

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

      for (const item of order.items) {
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

        const itemShipping = totalShippingVal * proportion
        const itemNetProfit = itemSale - itemCogs - itemShipping - itemCostCodes

        lineItemRows.push({
          id: `${order.id}:${item.id}`,
          orderId: order.id,
          olmNumber: null,
          marketplaceOrderId: order.orderNumber,
          source: 'wholesale',
          orderDate: (order.shippedAt ?? order.orderDate).toISOString(),
          asin: null,
          sellerSku: item.sku,
          title: item.title,
          quantity: Number(item.quantity),
          saleValue: Math.round(itemSale * 100) / 100,
          totalCogs: Math.round(itemCogs * 100) / 100,
          commission: 0,
          customerShipping: 0,
          shippingCost: Math.round(itemShipping * 100) / 100,
          costCodeDeductions: Math.round(itemCostCodes * 100) / 100,
          netProfit: Math.round(itemNetProfit * 100) / 100,
          commissionSynced: true,
        })
      }
    }

    finalRows = lineItemRows
  }

  // ── Search filtering ────────────────────────────────────────────────────
  if (search) {
    finalRows = finalRows.filter((r) => {
      const fields = [r.marketplaceOrderId, r.olmNumber != null ? `OLM-${r.olmNumber}` : '', r.source]
      if ('sellerSku' in r) {
        fields.push(r.sellerSku ?? '', r.title ?? '', r.asin ?? '')
      }
      return fields.some((f) => String(f).toLowerCase().includes(search))
    })
  }

  // Sort all rows by date desc
  finalRows.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())

  // Summary (calculated from filtered rows)
  const totalRevenue = finalRows.reduce((s, r) => s + r.saleValue, 0)
  const totalCogs = finalRows.reduce((s, r) => s + r.totalCogs, 0)
  const totalCommission = finalRows.reduce((s, r) => s + r.commission, 0)
  const totalCustomerShipping = finalRows.reduce((s, r) => s + r.customerShipping, 0)
  const totalShipping = finalRows.reduce((s, r) => s + r.shippingCost, 0)
  const totalCostCodes = finalRows.reduce((s, r) => s + r.costCodeDeductions, 0)
  const totalNetProfit = finalRows.reduce((s, r) => s + r.netProfit, 0)

  // Paginate
  const totalCount = finalRows.length
  const paged = finalRows.slice((page - 1) * pageSize, page * pageSize)

  return NextResponse.json({
    rows: paged,
    totalCount,
    page,
    pageSize,
    view,
    summary: {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCogs: Math.round(totalCogs * 100) / 100,
      totalCommission: Math.round(totalCommission * 100) / 100,
      totalCustomerShipping: Math.round(totalCustomerShipping * 100) / 100,
      totalShipping: Math.round(totalShipping * 100) / 100,
      totalCostCodes: Math.round(totalCostCodes * 100) / 100,
      totalNetProfit: Math.round(totalNetProfit * 100) / 100,
    },
  })
}
