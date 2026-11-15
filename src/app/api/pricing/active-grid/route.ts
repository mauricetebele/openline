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
      WHERE sl."accountId" = ${accountId}
        AND sl.asin IS NOT NULL
        AND sl."listingStatus" = 'Active'
      ORDER BY s30 DESC, sl.asin ASC, sl.condition ASC
    `

    return NextResponse.json({ data: rows })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load pricing grid'
    console.error('[GET /api/pricing/active-grid]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
