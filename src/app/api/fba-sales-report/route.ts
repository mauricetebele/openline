/**
 * GET /api/fba-sales-report
 *
 * FBA-specific profitability report for mapped FBA marketplace SKUs.
 * Shows profitability per SKU (aggregated) or per order (individual).
 *
 * COGS: FIFO from FBA shipment serials + manual FBA removes (fallback: latest PO line per product+grade)
 * Cost Code: PurchaseOrderLine.costCodeId -> CostCode.amount
 * FBA Fee: Order.marketplaceCommission allocated proportionally per item by sale price
 *
 * Query params: startDate, endDate, page, pageSize, view ('sku' | 'order'), search
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
  const view = searchParams.get('view') ?? 'sku' // 'sku' | 'order'
  const search = searchParams.get('search')?.trim().toLowerCase() || ''

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  const dateFrom = new Date(startDate + 'T00:00:00Z')
  const dateTo = new Date(endDate + 'T23:59:59.999Z')

  // ── Fallback COGS lookup: latest unit cost per product+grade ──────────
  const [cogsRows, costCodeRows, fifoShipmentRows, fifoManualRows] = await Promise.all([
    prisma.$queryRaw<
      { productId: string; gradeId: string | null; unitCost: number }[]
    >(Prisma.sql`
      SELECT DISTINCT ON ("productId", "gradeId")
        "productId", "gradeId", "unitCost"::float8 as "unitCost"
      FROM purchase_order_lines
      ORDER BY "productId", "gradeId", "createdAt" DESC
    `),
    prisma.$queryRaw<
      { productId: string; gradeId: string | null; amount: number }[]
    >(Prisma.sql`
      SELECT DISTINCT ON (pol."productId", pol."gradeId")
        pol."productId", pol."gradeId", cc."amount"::float8 as "amount"
      FROM purchase_order_lines pol
      JOIN cost_codes cc ON cc.id = pol."costCodeId"
      WHERE pol."costCodeId" IS NOT NULL
      ORDER BY pol."productId", pol."gradeId", pol."createdAt" DESC
    `),
    // ── FIFO Query A: FBA Shipment Serial Assignments ──────────────────
    prisma.$queryRaw<
      { sellerSku: string; unitCost: number; costCodeAmount: number; sentAt: Date }[]
    >(Prisma.sql`
      SELECT fsi."sellerSku", pol."unitCost"::float8 AS "unitCost",
             COALESCE(cc."amount",0)::float8 AS "costCodeAmount",
             fssa."assignedAt" AS "sentAt"
      FROM fba_shipment_serial_assignments fssa
      JOIN fba_shipments fs ON fs.id = fssa."fbaShipmentId"
      JOIN fba_shipment_items fsi ON fsi.id = fssa."fbaShipmentItemId"
      JOIN inventory_serials s ON s.id = fssa."inventorySerialId"
      JOIN po_receipt_lines prl ON prl.id = s."receiptLineId"
      JOIN purchase_order_lines pol ON pol.id = prl."purchaseOrderLineId"
      LEFT JOIN cost_codes cc ON cc.id = pol."costCodeId"
      WHERE fs.status = 'SHIPPED'
      ORDER BY fssa."assignedAt" ASC
    `),
    // ── FIFO Query B: Manual FBA Remove Events ─────────────────────────
    prisma.$queryRaw<
      { sellerSku: string; unitCost: number; costCodeAmount: number; sentAt: Date }[]
    >(Prisma.sql`
      SELECT DISTINCT ON (sh.id)
        pgms."sellerSku", pol."unitCost"::float8 AS "unitCost",
        COALESCE(cc."amount",0)::float8 AS "costCodeAmount",
        sh."createdAt" AS "sentAt"
      FROM serial_history sh
      JOIN inventory_serials s ON s.id = sh."inventorySerialId"
      JOIN po_receipt_lines prl ON prl.id = s."receiptLineId"
      JOIN purchase_order_lines pol ON pol.id = prl."purchaseOrderLineId"
      LEFT JOIN cost_codes cc ON cc.id = pol."costCodeId"
      JOIN product_grade_marketplace_skus pgms ON pgms."productId" = s."productId"
        AND (pgms."gradeId" = s."gradeId" OR (pgms."gradeId" IS NULL AND s."gradeId" IS NULL))
      JOIN marketplace_listings ml ON ml."mskuId" = pgms.id
      WHERE sh."eventType" = 'MANUAL_REMOVE' AND sh.notes LIKE 'MANUAL FBA%'
        AND ml."fulfillmentChannel" = 'FBA'
      ORDER BY sh.id, sh."createdAt" ASC
    `),
  ])

  const cogsMap = new Map<string, number>()
  const cogsProductOnly = new Map<string, number>()
  for (const row of cogsRows) {
    cogsMap.set(`${row.productId}:${row.gradeId ?? ''}`, row.unitCost)
    if (!cogsProductOnly.has(row.productId)) {
      cogsProductOnly.set(row.productId, row.unitCost)
    }
  }

  const costCodeMap = new Map<string, number>()
  const costCodeProductOnly = new Map<string, number>()
  for (const row of costCodeRows) {
    costCodeMap.set(`${row.productId}:${row.gradeId ?? ''}`, row.amount)
    if (!costCodeProductOnly.has(row.productId)) {
      costCodeProductOnly.set(row.productId, row.amount)
    }
  }

  // ── Build FIFO queues per SKU ───────────────────────────────────────
  type FifoUnit = { unitCost: number; costCodeAmount: number }
  const fifoQueues = new Map<string, FifoUnit[]>()

  const allFifoUnits = [...fifoShipmentRows, ...fifoManualRows]
    .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())

  for (const row of allFifoUnits) {
    let queue = fifoQueues.get(row.sellerSku)
    if (!queue) {
      queue = []
      fifoQueues.set(row.sellerSku, queue)
    }
    queue.push({ unitCost: row.unitCost, costCodeAmount: row.costCodeAmount })
  }

  // FIFO pointer per SKU (index into the queue)
  const fifoPointers = new Map<string, number>()

  /** Consume N units from FIFO queue for a SKU, returns { totalCost, totalCostCode } */
  function consumeFifo(
    sku: string,
    qty: number,
    fallbackCogs: number,
    fallbackCostCode: number,
  ): { totalCost: number; totalCostCode: number } {
    const queue = fifoQueues.get(sku)
    let ptr = fifoPointers.get(sku) ?? 0
    let totalCost = 0
    let totalCostCode = 0
    let consumed = 0

    if (queue) {
      while (consumed < qty && ptr < queue.length) {
        totalCost += queue[ptr].unitCost
        totalCostCode += queue[ptr].costCodeAmount
        ptr++
        consumed++
      }
      fifoPointers.set(sku, ptr)
    }

    // Fallback for remaining units when queue is exhausted
    const remaining = qty - consumed
    if (remaining > 0) {
      totalCost += fallbackCogs * remaining
      totalCostCode += fallbackCostCode * remaining
    }

    return { totalCost, totalCostCode }
  }

  // ── SKU -> product+grade mapping ──────────────────────────────────────
  const skuMap = new Map<string, { productId: string; gradeId: string | null }>()
  const allProducts = await prisma.product.findMany({ select: { id: true, sku: true } })
  for (const p of allProducts) skuMap.set(p.sku, { productId: p.id, gradeId: null })
  const mskuRows = await prisma.productGradeMarketplaceSku.findMany({
    select: { sellerSku: true, productId: true, gradeId: true },
  })
  for (const m of mskuRows) skuMap.set(m.sellerSku, { productId: m.productId, gradeId: m.gradeId })

  // ── Build set of valid FBA seller SKUs ────────────────────────────────
  const fbaSkuRows = await prisma.$queryRaw<{ sellerSku: string }[]>(Prisma.sql`
    SELECT pgms."sellerSku"
    FROM product_grade_marketplace_skus pgms
    JOIN marketplace_listings ml ON ml."mskuId" = pgms.id
    WHERE ml."fulfillmentChannel" = 'FBA'
  `)
  const fbaSkuSet = new Set(fbaSkuRows.map(r => r.sellerSku))

  if (fbaSkuSet.size === 0) {
    return NextResponse.json({
      rows: [], totalCount: 0, page, pageSize, view,
      summary: { totalRevenue: 0, totalCogs: 0, totalFbaFees: 0, totalCostCodes: 0, totalProfit: 0, profitMargin: 0 },
    })
  }

  // ── Build product+grade name lookup ───────────────────────────────────
  const productNameMap = new Map<string, string>()
  const allProds = await prisma.product.findMany({ select: { id: true, description: true } })
  for (const p of allProds) productNameMap.set(p.id, p.description)

  const gradeNameMap = new Map<string, string>()
  const allGrades = await prisma.grade.findMany({ select: { id: true, grade: true } })
  for (const g of allGrades) gradeNameMap.set(g.id, g.grade)

  // ── Consume pre-range FBA sales (advance FIFO pointers) ──────────────
  const preRangeSales = await prisma.$queryRaw<
    { sellerSku: string; quantityOrdered: number }[]
  >(Prisma.sql`
    SELECT oi."sellerSku", oi."quantityOrdered"
    FROM orders o JOIN order_items oi ON oi."orderId" = o.id
    WHERE o."workflowStatus" = 'SHIPPED' AND o."orderSource" = 'amazon' AND o."fulfillmentChannel" = 'AFN'
      AND oi."sellerSku" IS NOT NULL
      AND COALESCE(o."shippedAt", o."purchaseDate") < ${dateFrom}
    ORDER BY COALESCE(o."shippedAt", o."purchaseDate") ASC
  `)

  for (const row of preRangeSales) {
    // Advance pointer only — no output rows
    const queue = fifoQueues.get(row.sellerSku)
    if (queue) {
      let ptr = fifoPointers.get(row.sellerSku) ?? 0
      ptr = Math.min(ptr + row.quantityOrdered, queue.length)
      fifoPointers.set(row.sellerSku, ptr)
    }
  }

  // ── Query shipped FBA orders (sorted ASC for FIFO consumption) ──────
  const fbaWhere = {
    workflowStatus: 'SHIPPED' as const,
    orderSource: 'amazon',
    fulfillmentChannel: 'AFN',
    OR: [
      { shippedAt: { gte: dateFrom, lte: dateTo } },
      { shippedAt: null, purchaseDate: { gte: dateFrom, lte: dateTo } },
    ],
  }

  const fbaOrders = await prisma.order.findMany({
    where: fbaWhere,
    include: {
      items: true,
    },
    orderBy: { purchaseDate: 'asc' },
  })

  // ── Build per-item rows (only FBA-mapped SKUs) ────────────────────────
  type ItemRow = {
    orderId: string
    olmNumber: number | null
    amazonOrderId: string
    orderDate: string
    sellerSku: string
    productName: string
    grade: string
    quantity: number
    isReplacement: boolean
    salePrice: number
    cogs: number
    costCode: number
    commission: number
    fbaFee: number
    profit: number
    margin: number
  }

  const itemRows: ItemRow[] = []

  for (const order of fbaOrders) {
    const totalCommission = Number(order.marketplaceCommission ?? 0)
    const totalFbaFee = Number(order.fbaFulfillmentFee ?? 0)

    // Total order price for proportional fee allocation
    const totalOrderPrice = order.items.reduce((sum, item) => sum + Number(item.itemPrice ?? 0), 0)

    for (const item of order.items) {
      const sku = item.sellerSku
      if (!sku || !fbaSkuSet.has(sku)) continue

      const mapping = skuMap.get(sku)
      const productName = mapping ? (productNameMap.get(mapping.productId) ?? sku) : sku
      const grade = mapping?.gradeId ? (gradeNameMap.get(mapping.gradeId) ?? '') : ''

      const salePrice = Number(item.itemPrice ?? 0)

      // COGS via FIFO queue, falling back to latest PO line cost
      let itemCogs = 0
      let itemCostCode = 0
      if (mapping) {
        const key = `${mapping.productId}:${mapping.gradeId ?? ''}`
        const fallbackCogs = cogsMap.get(key) ?? cogsProductOnly.get(mapping.productId) ?? 0
        const fallbackCostCode = costCodeMap.get(key) ?? costCodeProductOnly.get(mapping.productId) ?? 0
        const fifo = consumeFifo(sku, item.quantityOrdered, fallbackCogs, fallbackCostCode)
        itemCogs = fifo.totalCost
        itemCostCode = fifo.totalCostCode
      }

      // Fee proportional allocation
      const proportion = totalOrderPrice > 0 ? salePrice / totalOrderPrice : 0
      const itemCommission = totalCommission * proportion
      const itemFbaFee = totalFbaFee * proportion

      const isRepl = order.isReplacement === true
      const profit = isRepl ? 0 : salePrice - itemCogs - itemCostCode - itemCommission - itemFbaFee
      const margin = isRepl ? 0 : salePrice > 0 ? (profit / salePrice) * 100 : 0

      itemRows.push({
        orderId: order.id,
        olmNumber: order.olmNumber,
        amazonOrderId: order.amazonOrderId,
        orderDate: (order.shippedAt ?? order.purchaseDate).toISOString(),
        sellerSku: sku,
        productName,
        grade,
        quantity: item.quantityOrdered,
        isReplacement: isRepl,
        salePrice: isRepl ? 0 : Math.round(salePrice * 100) / 100,
        cogs: isRepl ? 0 : Math.round(itemCogs * 100) / 100,
        costCode: isRepl ? 0 : Math.round(itemCostCode * 100) / 100,
        commission: isRepl ? 0 : Math.round(itemCommission * 100) / 100,
        fbaFee: isRepl ? 0 : Math.round(itemFbaFee * 100) / 100,
        profit: isRepl ? 0 : Math.round(profit * 100) / 100,
        margin: isRepl ? 0 : Math.round(margin * 10) / 10,
      })
    }
  }

  // ── Build response based on view ──────────────────────────────────────
  if (view === 'sku') {
    // Aggregate by sellerSku
    const skuAgg = new Map<string, {
      sellerSku: string
      productName: string
      grade: string
      unitsSold: number
      totalRevenue: number
      totalCogs: number
      totalCostCodes: number
      totalCommissions: number
      totalFbaFees: number
      totalProfit: number
    }>()

    for (const row of itemRows) {
      if (row.isReplacement) continue // Exclude replacements from SKU aggregation
      const existing = skuAgg.get(row.sellerSku)
      if (existing) {
        existing.unitsSold += row.quantity
        existing.totalRevenue += row.salePrice
        existing.totalCogs += row.cogs
        existing.totalCostCodes += row.costCode
        existing.totalCommissions += row.commission
        existing.totalFbaFees += row.fbaFee
        existing.totalProfit += row.profit
      } else {
        skuAgg.set(row.sellerSku, {
          sellerSku: row.sellerSku,
          productName: row.productName,
          grade: row.grade,
          unitsSold: row.quantity,
          totalRevenue: row.salePrice,
          totalCogs: row.cogs,
          totalCostCodes: row.costCode,
          totalCommissions: row.commission,
          totalFbaFees: row.fbaFee,
          totalProfit: row.profit,
        })
      }
    }

    let skuRows = Array.from(skuAgg.values()).map(s => ({
      sellerSku: s.sellerSku,
      productName: s.productName,
      grade: s.grade,
      unitsSold: s.unitsSold,
      avgSalePrice: Math.round((s.totalRevenue / s.unitsSold) * 100) / 100,
      avgUnitCost: Math.round((s.totalCogs / s.unitsSold) * 100) / 100,
      avgCostCode: Math.round((s.totalCostCodes / s.unitsSold) * 100) / 100,
      avgCommission: Math.round((s.totalCommissions / s.unitsSold) * 100) / 100,
      avgFbaFee: Math.round((s.totalFbaFees / s.unitsSold) * 100) / 100,
      avgProfit: Math.round((s.totalProfit / s.unitsSold) * 100) / 100,
      totalRevenue: Math.round(s.totalRevenue * 100) / 100,
      totalCogs: Math.round(s.totalCogs * 100) / 100,
      totalCostCodes: Math.round(s.totalCostCodes * 100) / 100,
      totalCommissions: Math.round(s.totalCommissions * 100) / 100,
      totalFbaFees: Math.round(s.totalFbaFees * 100) / 100,
      totalProfit: Math.round(s.totalProfit * 100) / 100,
      margin: s.totalRevenue > 0 ? Math.round((s.totalProfit / s.totalRevenue) * 1000) / 10 : 0,
    }))

    // Search filter
    if (search) {
      skuRows = skuRows.filter(r =>
        r.sellerSku.toLowerCase().includes(search) ||
        r.productName.toLowerCase().includes(search) ||
        r.grade.toLowerCase().includes(search)
      )
    }

    // Sort by total profit desc
    skuRows.sort((a, b) => b.totalProfit - a.totalProfit)

    const totalCount = skuRows.length
    const paged = skuRows.slice((page - 1) * pageSize, page * pageSize)

    const totalRevenue = skuRows.reduce((s, r) => s + r.totalRevenue, 0)
    const totalCogs = skuRows.reduce((s, r) => s + r.totalCogs, 0)
    const totalCommissions = skuRows.reduce((s, r) => s + r.totalCommissions, 0)
    const totalFbaFees = skuRows.reduce((s, r) => s + r.totalFbaFees, 0)
    const totalCostCodes = skuRows.reduce((s, r) => s + r.totalCostCodes, 0)
    const totalProfit = skuRows.reduce((s, r) => s + r.totalProfit, 0)

    return NextResponse.json({
      rows: paged,
      totalCount,
      page,
      pageSize,
      view,
      summary: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCogs: Math.round(totalCogs * 100) / 100,
        totalCommissions: Math.round(totalCommissions * 100) / 100,
        totalFbaFees: Math.round(totalFbaFees * 100) / 100,
        totalCostCodes: Math.round(totalCostCodes * 100) / 100,
        totalProfit: Math.round(totalProfit * 100) / 100,
        profitMargin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 1000) / 10 : 0,
      },
    })
  }

  // ── Order view ────────────────────────────────────────────────────────
  let orderRows = itemRows

  if (search) {
    orderRows = orderRows.filter(r =>
      r.sellerSku.toLowerCase().includes(search) ||
      r.productName.toLowerCase().includes(search) ||
      r.amazonOrderId.toLowerCase().includes(search) ||
      (r.olmNumber != null && `olm-${r.olmNumber}`.includes(search))
    )
  }

  orderRows.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())

  const totalCount = orderRows.length
  const paged = orderRows.slice((page - 1) * pageSize, page * pageSize)

  // Exclude replacement orders from summary totals
  const nonReplacementRows = orderRows.filter(r => !r.isReplacement)
  const totalRevenue = nonReplacementRows.reduce((s, r) => s + r.salePrice, 0)
  const totalCogs = nonReplacementRows.reduce((s, r) => s + r.cogs, 0)
  const totalCommissions = nonReplacementRows.reduce((s, r) => s + r.commission, 0)
  const totalFbaFees = nonReplacementRows.reduce((s, r) => s + r.fbaFee, 0)
  const totalCostCodes = nonReplacementRows.reduce((s, r) => s + r.costCode, 0)
  const totalProfit = nonReplacementRows.reduce((s, r) => s + r.profit, 0)

  return NextResponse.json({
    rows: paged,
    totalCount,
    page,
    pageSize,
    view,
    summary: {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCogs: Math.round(totalCogs * 100) / 100,
      totalCommissions: Math.round(totalCommissions * 100) / 100,
      totalFbaFees: Math.round(totalFbaFees * 100) / 100,
      totalCostCodes: Math.round(totalCostCodes * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      profitMargin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 1000) / 10 : 0,
    },
  })
}
