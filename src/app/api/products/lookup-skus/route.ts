/**
 * POST /api/products/lookup-skus
 * Body: { skus: string[], includeAllGrades?: boolean }  (max 200)
 *
 * Looks up products by internal SKU and returns inventory grouped by grade.
 * Used by the bulk listing creator to auto-expand rows per grade.
 * includeAllGrades: also return every grade with no stock (availableQty 0), so
 * listings can be created ahead of inventory.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

const bodySchema = z.object({
  skus: z.array(z.string().min(1)).min(1).max(200),
  includeAllGrades: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
    }

    const { skus, includeAllGrades } = parsed.data
    const uniqueSkus = Array.from(new Set(skus.map(s => s.trim()).filter(Boolean)))

    // Fetch matching products
    const products = await prisma.product.findMany({
      where: { sku: { in: uniqueSkus }, archivedAt: null },
      select: {
        id: true, sku: true, description: true,
        marketplaceSkus: { select: { marketplace: true, gradeId: true, sellerSku: true, suspended: true } },
      },
    })

    const productIds = products.map(p => p.id)
    const productMap = new Map(products.map(p => [p.id, p]))

    // Fulfillment channel (FBA vs MFN) for amazon seller SKUs — mirrors the
    // inventory marketplace cell so "live" logos match the inventory view.
    const allSellerSkus = new Set<string>()
    for (const p of products) {
      for (const ms of p.marketplaceSkus) {
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

    // Average FULL cost (base + cost code + repair) of in-stock units at
    // finished-goods locations, per product+grade. Mirrors the inventory cost
    // model and adds per-serial repair costs.
    const fgCostRows = productIds.length > 0
      ? await prisma.$queryRaw<{ productId: string; gradeId: string | null; avgCost: number }[]>`
          SELECT s."productId", s."gradeId",
                 AVG(
                   COALESCE(pol."unitCost", s."unitCost", 0)
                   + COALESCE(cc.amount, 0)
                   + COALESCE(rc.repair_total, 0)
                 )::float8 AS "avgCost"
          FROM inventory_serials s
          JOIN locations loc ON loc.id = s."locationId" AND loc."isFinishedGoods" = true
          LEFT JOIN po_receipt_lines prl ON prl.id = s."receiptLineId"
          LEFT JOIN purchase_order_lines pol ON pol.id = prl."purchaseOrderLineId"
          LEFT JOIN cost_codes cc ON cc.id = pol."costCodeId"
          LEFT JOIN LATERAL (
            SELECT SUM(roi."repairCost") AS repair_total
            FROM repair_order_items roi
            WHERE roi."inventorySerialId" = s.id
          ) rc ON true
          WHERE s.status = 'IN_STOCK' AND s."productId" = ANY(${productIds})
          GROUP BY s."productId", s."gradeId"
        `
      : []
    const fgCostMap = new Map(fgCostRows.map(r => [`${r.productId}:${r.gradeId ?? ''}`, r.avgCost]))

    // Per product+grade: which marketplaces the SKU is mapped (live) on.
    const mpFlags = (productId: string, gradeId: string | null) => {
      const matched = (productMap.get(productId)?.marketplaceSkus ?? [])
        .filter(s => (s.gradeId ?? null) === (gradeId ?? null))
      const amazonSkus = matched.filter(s => s.marketplace === 'amazon')
      const bmSkus = matched.filter(s => s.marketplace === 'backmarket')
      return {
        hasMfn: amazonSkus.some(s => (fcMap.get(s.sellerSku) ?? null) !== 'FBA'),
        hasFba: amazonSkus.some(s => (fcMap.get(s.sellerSku) ?? null) === 'FBA'),
        hasBm: bmSkus.length > 0,
        amazonSuspended: amazonSkus.length > 0 && amazonSkus.every(s => s.suspended),
        bmSuspended: bmSkus.length > 0 && bmSkus.every(s => s.suspended),
      }
    }

    // Group inventory by product+grade (only items with qty > 0)
    const inventoryGroups = await prisma.inventoryItem.groupBy({
      by: ['productId', 'gradeId'],
      where: { productId: { in: productIds }, qty: { gt: 0 } },
      _sum: { qty: true },
    })

    // Collect all grade IDs to look up names (every grade when includeAllGrades)
    const gradeIds = inventoryGroups
      .map(g => g.gradeId)
      .filter((id): id is string => id !== null)
    const grades = includeAllGrades
      ? await prisma.grade.findMany({ select: { id: true, grade: true } })
      : gradeIds.length > 0
        ? await prisma.grade.findMany({
            where: { id: { in: Array.from(new Set(gradeIds)) } },
            select: { id: true, grade: true },
          })
        : []
    const gradeMap = new Map(grades.map(g => [g.id, g.grade]))

    // Build per-product grade arrays
    const productGrades = new Map<string, { gradeId: string | null; gradeName: string | null; availableQty: number }[]>()
    for (const group of inventoryGroups) {
      const arr = productGrades.get(group.productId) ?? []
      arr.push({
        gradeId: group.gradeId,
        gradeName: group.gradeId ? (gradeMap.get(group.gradeId) ?? null) : null,
        availableQty: group._sum.qty ?? 0,
      })
      productGrades.set(group.productId, arr)
    }

    // Fill in out-of-stock grades so every product × grade combo is listable
    if (includeAllGrades) {
      for (const p of products) {
        const arr = productGrades.get(p.id) ?? []
        const have = new Set(arr.map(g => g.gradeId))
        for (const g of grades) {
          if (!have.has(g.id)) arr.push({ gradeId: g.id, gradeName: g.grade, availableQty: 0 })
        }
        productGrades.set(p.id, arr)
      }
    }

    // Build found array
    const foundSkus = new Set<string>()
    const found = products.map(p => {
      foundSkus.add(p.sku.toLowerCase())
      return {
        product: { id: p.id, sku: p.sku, description: p.description },
        grades: (productGrades.get(p.id) ?? [])
          .sort((a, b) => {
            if (!a.gradeName) return 1
            if (!b.gradeName) return -1
            return a.gradeName.localeCompare(b.gradeName)
          })
          .map(g => ({ ...g, mp: mpFlags(p.id, g.gradeId), avgCost: fgCostMap.get(`${p.id}:${g.gradeId ?? ''}`) ?? null })),
      }
    })

    // Determine not-found SKUs
    const notFound = uniqueSkus.filter(s => !foundSkus.has(s.toLowerCase()))

    return NextResponse.json({ found, notFound })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/products/lookup-skus]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
