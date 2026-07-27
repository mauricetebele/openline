/**
 * GET /api/orders/match-by-sku?sku=X&accountId=Y&gradeId=Z
 * Finds the oldest single-qty AWAITING_VERIFICATION order that needs the given SKU
 * AND whose resolved grade matches the scanned serial's grade.
 * Supports both direct sellerSku matches and graded items via marketplace SKU mappings.
 *
 * Grade matching mirrors the serialize/validate routes: an order item's expected grade
 * is orderItem.gradeId, falling back to the grade of its marketplace-SKU mapping. A scan
 * resolves only to an order whose expected grade equals the scanned grade — both null
 * (ungraded ↔ ungraded) or the same gradeId (e.g. GRADE C ↔ GRADE C). This prevents a
 * graded scan from resolving to an ungraded order (or vice versa) when multiple orders
 * exist for the same product across different grades.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { pickGradeMatchedOrder } from '@/lib/serial-grade-match'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sku = req.nextUrl.searchParams.get('sku')?.trim()
  const accountId = req.nextUrl.searchParams.get('accountId')?.trim()
  const gradeId = req.nextUrl.searchParams.get('gradeId')?.trim() || null
  if (!sku) return NextResponse.json({ error: 'Missing sku parameter' }, { status: 400 })
  if (!accountId) return NextResponse.json({ error: 'Missing accountId parameter' }, { status: 400 })

  // Build the set of sellerSkus that could belong to this product, across ALL grades:
  // 1. The SKU itself (direct match, typically the ungraded listing)
  // 2. Every marketplace SKU mapped to the product (each carries its own gradeId)
  // We intentionally gather all grades here and filter by grade below, per-order — the
  // candidate query alone cannot distinguish grades because the base SKU can appear on
  // an ungraded order regardless of what grade was scanned.
  const mappings = await prisma.productGradeMarketplaceSku.findMany({
    where: { product: { sku } },
    select: { sellerSku: true, gradeId: true },
  })
  // sellerSku -> gradeId (null gradeId means the mapping is ungraded)
  const skuToGradeId = new Map<string, string | null>()
  for (const m of mappings) skuToGradeId.set(m.sellerSku, m.gradeId)

  const skusToMatch = Array.from(new Set([sku, ...mappings.map(m => m.sellerSku)]))

  // Find the oldest AWAITING_VERIFICATION order where:
  // 1. Has an item with matching sellerSku (direct or via marketplace mapping)
  // 2. Single-qty order (only one item with qty 1)
  // 3. Resolved grade matches the scanned serial's grade
  const candidates = await prisma.order.findMany({
    where: {
      accountId,
      workflowStatus: 'AWAITING_VERIFICATION',
      items: { some: { sellerSku: { in: skusToMatch } } },
    },
    include: {
      items: { orderBy: { sellerSku: 'asc' } },
      label: {
        select: {
          trackingNumber: true,
          labelFormat: true,
          carrier: true,
          serviceCode: true,
          shipmentCost: true,
          createdAt: true,
          isTest: true,
          ssShipmentId: true,
        },
      },
      serialAssignments: {
        select: {
          id: true,
          orderItemId: true,
          inventorySerial: { select: { serialNumber: true } },
        },
      },
    },
    orderBy: { purchaseDate: 'asc' },
  })

  // Filter to single-qty orders whose resolved grade matches the scanned grade.
  const match = pickGradeMatchedOrder(candidates, skusToMatch, skuToGradeId, gradeId)

  return NextResponse.json({ match: match ?? null })
}
