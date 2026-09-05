/**
 * GET /api/product-families/[id]/details
 * Per product in the family, grouped by grade: ready-for-sale qty (finished-goods
 * on-hand) and each mapped marketplace SKU's live price + net margin. Margin is
 * only computed when there's finished-goods stock for that product+grade.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { resolveFees, marginAtPrice, type CalcTemplate } from '@/lib/target-margin'

export const dynamic = 'force-dynamic'

const pgKey = (p: string, g: string | null | undefined) => `${p}:${g ?? ''}`

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const products = await prisma.product.findMany({
    where: { familyId: params.id },
    select: { id: true, sku: true, defaultPackagePresetId: true },
  })
  if (products.length === 0) return NextResponse.json({ products: [] })
  const productIds = products.map(p => p.id)

  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: { productId: { in: productIds } },
    select: { id: true, productId: true, gradeId: true, marketplace: true, sellerSku: true, calculationTemplateId: true, grade: { select: { grade: true } } },
    orderBy: [{ marketplace: 'asc' }, { sellerSku: 'asc' }],
  })

  // Ready-for-sale = on-hand in finished-goods locations, per product+grade.
  const invGroups = await prisma.inventoryItem.groupBy({
    by: ['productId', 'gradeId'],
    where: { productId: { in: productIds }, location: { isFinishedGoods: true } },
    _sum: { qty: true },
  })
  const readyMap = new Map<string, number>()
  for (const g of invGroups) readyMap.set(pgKey(g.productId, g.gradeId), g._sum.qty ?? 0)

  // Avg landed cost (unit + cost-code) of in-stock finished-goods serials, per product+grade.
  const avgCostRows = await prisma.$queryRaw<{ productId: string; gradeId: string | null; avgUnitCost: number; avgCostCode: number }[]>`
    SELECT s."productId", s."gradeId",
      AVG(COALESCE(pol."unitCost", s."unitCost", 0))::float8 AS "avgUnitCost",
      AVG(COALESCE(cc.amount, 0))::float8 AS "avgCostCode"
    FROM inventory_serials s
    JOIN locations loc ON loc.id = s."locationId" AND loc."isFinishedGoods" = true
    LEFT JOIN po_receipt_lines prl ON prl.id = s."receiptLineId"
    LEFT JOIN purchase_order_lines pol ON pol.id = prl."purchaseOrderLineId"
    LEFT JOIN cost_codes cc ON cc.id = pol."costCodeId"
    WHERE s.status = 'IN_STOCK' AND s."productId" = ANY(${productIds}::text[])
    GROUP BY s."productId", s."gradeId"`
  const avgUnitCostMap = new Map<string, number>()
  const avgCostCodeMap = new Map<string, number>()
  for (const r of avgCostRows) { avgUnitCostMap.set(pgKey(r.productId, r.gradeId), r.avgUnitCost); avgCostCodeMap.set(pgKey(r.productId, r.gradeId), r.avgCostCode) }

  // Fallback cost for non-serialized: latest PO line + its cost code.
  const fbRows = await prisma.$queryRaw<{ productId: string; gradeId: string | null; unitCost: number; costCodeAmount: number | null }[]>`
    SELECT DISTINCT ON (pol."productId", pol."gradeId")
      pol."productId", pol."gradeId", pol."unitCost"::float8 AS "unitCost", cc.amount::float8 AS "costCodeAmount"
    FROM purchase_order_lines pol
    LEFT JOIN cost_codes cc ON cc.id = pol."costCodeId"
    WHERE pol."productId" = ANY(${productIds}::text[])
    ORDER BY pol."productId", pol."gradeId", pol."createdAt" DESC`
  const fbUnitCostMap = new Map<string, number>()
  const fbCostCodeMap = new Map<string, number>()
  for (const r of fbRows) { fbUnitCostMap.set(pgKey(r.productId, r.gradeId), r.unitCost); fbCostCodeMap.set(pgKey(r.productId, r.gradeId), r.costCodeAmount ?? 0) }

  // Prices.
  const amazonSkus = mskus.filter(m => m.marketplace === 'amazon').map(m => m.sellerSku)
  const bmSkus = mskus.filter(m => m.marketplace === 'backmarket').map(m => m.sellerSku)
  const sellerListings = amazonSkus.length ? await prisma.sellerListing.findMany({ where: { sku: { in: amazonSkus } }, select: { sku: true, accountId: true, price: true } }) : []
  const slMap = new Map(sellerListings.map(l => [l.sku, l]))
  const bmListings = bmSkus.length ? await prisma.marketplaceListing.findMany({ where: { marketplace: 'backmarket', sellerSku: { in: bmSkus } }, select: { sellerSku: true, price: true } }) : []
  const bmMap = new Map(bmListings.map(l => [l.sellerSku, l]))

  // Calculation templates (fees).
  const templateIds = Array.from(new Set(mskus.map(m => m.calculationTemplateId).filter(Boolean) as string[]))
  const templates = templateIds.length ? await prisma.calculationTemplate.findMany({ where: { id: { in: templateIds } }, include: { packageCosts: { select: { packagePresetId: true, cost: true } } } }) : []
  const tplMap = new Map<string, CalcTemplate>(templates.map(t => [t.id, { id: t.id, name: t.name, commissionPct: t.commissionPct.toString(), packageCosts: t.packageCosts.map(pc => ({ packagePresetId: pc.packagePresetId, cost: pc.cost.toString() })) }]))

  const grades = await prisma.grade.findMany({ select: { id: true, grade: true } })
  const gradeName = new Map(grades.map(g => [g.id, g.grade]))

  const result = products.map(p => {
    const productMskus = mskus.filter(m => m.productId === p.id)
    // Grade set: any grade with mskus, plus any grade with finished-goods stock.
    const gradeIds = new Set<string | null>()
    productMskus.forEach(m => gradeIds.add(m.gradeId ?? null))
    invGroups.filter(g => g.productId === p.id && (g._sum.qty ?? 0) > 0).forEach(g => gradeIds.add(g.gradeId ?? null))

    const gradeRows = Array.from(gradeIds).map(gid => {
      const key = pgKey(p.id, gid)
      const readyForSale = readyMap.get(key) ?? 0
      const avgUnitCost = avgUnitCostMap.get(key) ?? fbUnitCostMap.get(key) ?? null
      const avgCostCode = avgCostCodeMap.get(key) ?? fbCostCodeMap.get(key) ?? 0
      const listings = productMskus.filter(m => (m.gradeId ?? null) === gid).map(m => {
        const price = m.marketplace === 'amazon' ? (slMap.get(m.sellerSku)?.price ?? null) : m.marketplace === 'backmarket' ? (bmMap.get(m.sellerSku)?.price ?? null) : null
        const priceNum = price != null ? Number(price) : null
        const fees = resolveFees(tplMap.get(m.calculationTemplateId ?? '') ?? null, p.defaultPackagePresetId)
        // Margin only meaningful with finished-goods stock + known cost + a template.
        // Ship cost + landed cost as `cost`/`commissionPct` so the client recomputes
        // margin live as the price is edited (null ⇒ margin not applicable).
        const canMargin = readyForSale > 0 && avgUnitCost != null && !!fees
        const cost = canMargin ? avgUnitCost! + avgCostCode + fees!.shipping : null
        const marginPct = canMargin && priceNum != null ? marginAtPrice(priceNum, avgUnitCost!, avgCostCode, fees!) : null
        return {
          mskuId: m.id, marketplace: m.marketplace, sellerSku: m.sellerSku,
          accountId: m.marketplace === 'amazon' ? (slMap.get(m.sellerSku)?.accountId ?? null) : null,
          price: priceNum,
          cost, commissionPct: fees ? fees.commissionPct : null,
          marginPct: marginPct != null ? Math.round(marginPct * 10) / 10 : null,
        }
      })
      return { gradeId: gid, grade: gid ? (gradeName.get(gid) ?? '?') : 'Ungraded', readyForSale, listings }
    }).sort((a, b) => a.grade.localeCompare(b.grade))

    return { productId: p.id, grades: gradeRows }
  })

  return NextResponse.json({ products: result })
}
