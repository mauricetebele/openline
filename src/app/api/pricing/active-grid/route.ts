/**
 * GET /api/pricing/active-grid?accountId=X
 *
 * Active-listing pricing grid: every ACTIVE Amazon seller listing (broken down
 * by Amazon condition) whose SKU is mapped to an internal product+grade via an
 * active (non-suspended) marketplace-SKU mapping. Enriched with our price, the
 * stored Buy Box, whether our offer is Prime (FBA), the Buy Box winner, and
 * units sold over 1 / 3 / 7 / 30 days (from Amazon orders, attributed by SKU).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { resolveFees, marginAtPrice, type CalcTemplate } from '@/lib/target-margin'

export const dynamic = 'force-dynamic'

interface GridRow {
  id: string
  sku: string
  asin: string
  title: string | null
  condition: string | null
  fulfillmentChannel: string
  internalSku: string
  grade: string | null
  ourPrice: number | null
  minPrice: number | null
  maxPrice: number | null
  buyBoxPrice: number | null
  buyBoxSeller: string | null
  buyBoxIsPrime: boolean | null
  fgQty: number
  pushQty: number
  syncQty: boolean
  avgCost: number | null
  marginPct: number | null
  s1: number
  s3: number
  s7: number
  s30: number
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = req.nextUrl.searchParams.get('accountId')?.trim()
  if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

  try {
    const rows = await prisma.$queryRaw<GridRow[]>`
      WITH sales AS (
        SELECT oi."sellerSku",
          COALESCE(SUM(oi."quantityOrdered") FILTER (WHERE o."purchaseDate" >= now() - interval '1 day'), 0)::int  AS s1,
          COALESCE(SUM(oi."quantityOrdered") FILTER (WHERE o."purchaseDate" >= now() - interval '3 days'), 0)::int AS s3,
          COALESCE(SUM(oi."quantityOrdered") FILTER (WHERE o."purchaseDate" >= now() - interval '7 days'), 0)::int AS s7,
          COALESCE(SUM(oi."quantityOrdered"), 0)::int AS s30
        FROM order_items oi
        JOIN orders o ON o.id = oi."orderId"
        WHERE o."accountId" = ${accountId}
          AND o."orderSource" = 'amazon'
          AND o."purchaseDate" >= now() - interval '30 days'
          AND o."orderStatus" <> 'Canceled'
          AND oi."sellerSku" IS NOT NULL
        GROUP BY oi."sellerSku"
      ),
      fg_stock AS (
        SELECT ii."productId", ii."gradeId", SUM(ii.qty)::int AS fg_qty
        FROM inventory_items ii
        JOIN locations loc ON loc.id = ii."locationId" AND loc."isFinishedGoods" = true
        WHERE ii.qty > 0
        GROUP BY ii."productId", ii."gradeId"
      ),
      fg_cost AS (
        SELECT s."productId", s."gradeId",
          AVG(COALESCE(pol."unitCost", s."unitCost", 0))::float8 AS avg_unit_cost,
          AVG(COALESCE(cc.amount, 0))::float8                    AS avg_cost_code,
          AVG(COALESCE(rc.repair_total, 0))::float8             AS avg_repair
        FROM inventory_serials s
        JOIN locations loc ON loc.id = s."locationId" AND loc."isFinishedGoods" = true
        LEFT JOIN po_receipt_lines prl ON prl.id = s."receiptLineId"
        LEFT JOIN purchase_order_lines pol ON pol.id = prl."purchaseOrderLineId"
        LEFT JOIN cost_codes cc ON cc.id = pol."costCodeId"
        LEFT JOIN LATERAL (
          SELECT SUM(roi."repairCost") AS repair_total
          FROM repair_order_items roi WHERE roi."inventorySerialId" = s.id
        ) rc ON true
        WHERE s.status = 'IN_STOCK'
        GROUP BY s."productId", s."gradeId"
      )
      SELECT sl.id, sl.sku, sl.asin, sl."productTitle" AS title, sl.condition,
             sl."fulfillmentChannel" AS "fulfillmentChannel",
             p.sku AS "internalSku", g.grade AS grade,
             sl.price::float8        AS "ourPrice",
             sl."minPrice"::float8   AS "minPrice",
             sl."maxPrice"::float8   AS "maxPrice",
             sl."buyBoxPrice"::float8 AS "buyBoxPrice",
             sl."buyBoxSeller"       AS "buyBoxSeller",
             sl."buyBoxIsPrime"      AS "buyBoxIsPrime",
             COALESCE(fs.fg_qty, 0)  AS "fgQty",
             sl.quantity             AS "pushQty",
             pgms."syncQty"          AS "syncQty",
             fc.avg_unit_cost        AS "avgUnitCost",
             fc.avg_cost_code        AS "avgCostCode",
             fc.avg_repair           AS "avgRepair",
             pgms."calculationTemplateId" AS "calculationTemplateId",
             p."defaultPackagePresetId"   AS "defaultPackagePresetId",
             COALESCE(sa.s1, 0)  AS s1,
             COALESCE(sa.s3, 0)  AS s3,
             COALESCE(sa.s7, 0)  AS s7,
             COALESCE(sa.s30, 0) AS s30
      FROM seller_listings sl
      JOIN product_grade_marketplace_skus pgms
        ON pgms."sellerSku" = sl.sku AND pgms.marketplace = 'amazon' AND pgms.suspended = false
      JOIN products p ON p.id = pgms."productId"
      LEFT JOIN grades g ON g.id = pgms."gradeId"
      LEFT JOIN sales sa ON sa."sellerSku" = sl.sku
      LEFT JOIN fg_stock fs ON fs."productId" = pgms."productId" AND fs."gradeId" IS NOT DISTINCT FROM pgms."gradeId"
      LEFT JOIN fg_cost fc ON fc."productId" = pgms."productId" AND fc."gradeId" IS NOT DISTINCT FROM pgms."gradeId"
      WHERE sl."accountId" = ${accountId}
        AND sl.asin IS NOT NULL
        AND sl."listingStatus" = 'Active'
      ORDER BY s30 DESC, sl.asin ASC, sl.condition ASC
    ` as (GridRow & {
      avgUnitCost: number | null
      avgCostCode: number | null
      avgRepair: number | null
      calculationTemplateId: string | null
      defaultPackagePresetId: string | null
    })[]

    // Margin — same logic as the Marketplace SKUs page (resolveFees + marginAtPrice),
    // with repair folded into the unit cost so it matches the Avg Cost column.
    const templates = await prisma.calculationTemplate.findMany({
      include: { packageCosts: { select: { packagePresetId: true, cost: true } } },
    })
    const templateById = new Map<string, CalcTemplate>(
      templates.map(t => [t.id, { id: t.id, name: t.name, commissionPct: Number(t.commissionPct), packageCosts: t.packageCosts.map(c => ({ packagePresetId: c.packagePresetId, cost: Number(c.cost) })) }]),
    )

    // Merge listings that share the same ASIN + Amazon condition into one record:
    // shared fields (title, Buy Box, winner) once, sales summed, and one member
    // per internal SKU+grade mapped to that ASIN+condition.
    interface Member {
      id: string; sku: string; internalSku: string; grade: string | null
      fulfillmentChannel: string
      ourPrice: number | null; minPrice: number | null; maxPrice: number | null
      avgCost: number | null; marginPct: number | null
      fgQty: number; pushQty: number; syncQty: boolean
    }
    interface Group {
      key: string; asin: string; title: string | null; condition: string | null
      buyBoxPrice: number | null; buyBoxSeller: string | null; buyBoxIsPrime: boolean | null
      s1: number; s3: number; s7: number; s30: number
      members: Member[]
    }

    const groupMap = new Map<string, Group>()
    for (const r of rows) {
      const unit = r.avgUnitCost
      const code = r.avgCostCode ?? 0
      const repair = r.avgRepair ?? 0
      const avgCost = unit != null ? unit + code + repair : null
      const fees = resolveFees(r.calculationTemplateId ? templateById.get(r.calculationTemplateId) : null, r.defaultPackagePresetId)
      const marginPct = (r.ourPrice != null && unit != null && fees)
        ? marginAtPrice(r.ourPrice, unit + repair, code, fees)
        : null

      const key = `${r.asin}::${r.condition ?? ''}`
      let g = groupMap.get(key)
      if (!g) {
        g = {
          key, asin: r.asin, title: r.title, condition: r.condition,
          buyBoxPrice: r.buyBoxPrice, buyBoxSeller: r.buyBoxSeller, buyBoxIsPrime: r.buyBoxIsPrime,
          s1: 0, s3: 0, s7: 0, s30: 0, members: [],
        }
        groupMap.set(key, g)
      }
      if (g.buyBoxPrice == null && r.buyBoxPrice != null) {
        g.buyBoxPrice = r.buyBoxPrice; g.buyBoxSeller = r.buyBoxSeller; g.buyBoxIsPrime = r.buyBoxIsPrime
      }
      if (!g.title && r.title) g.title = r.title
      g.s1 += r.s1; g.s3 += r.s3; g.s7 += r.s7; g.s30 += r.s30
      g.members.push({
        id: r.id, sku: r.sku, internalSku: r.internalSku, grade: r.grade,
        fulfillmentChannel: r.fulfillmentChannel,
        ourPrice: r.ourPrice, minPrice: r.minPrice, maxPrice: r.maxPrice,
        avgCost, marginPct, fgQty: r.fgQty, pushQty: r.pushQty, syncQty: r.syncQty,
      })
    }

    return NextResponse.json({ data: Array.from(groupMap.values()) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load pricing grid'
    console.error('[GET /api/pricing/active-grid]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
