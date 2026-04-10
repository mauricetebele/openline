/**
 * GET /api/orders/match-by-sku?sku=X&accountId=Y&gradeId=Z
 * Finds the oldest single-qty AWAITING_VERIFICATION order that needs the given SKU.
 * Supports both direct sellerSku matches and graded items via marketplace SKU mappings.
 * When gradeId is provided, only matches marketplace SKUs for that specific grade.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sku = req.nextUrl.searchParams.get('sku')?.trim()
  const accountId = req.nextUrl.searchParams.get('accountId')?.trim()
  const gradeId = req.nextUrl.searchParams.get('gradeId')?.trim() || null
  if (!sku) return NextResponse.json({ error: 'Missing sku parameter' }, { status: 400 })
  if (!accountId) return NextResponse.json({ error: 'Missing accountId parameter' }, { status: 400 })

  // Build the set of sellerSkus to match:
  // 1. The SKU itself (direct match for ungraded items)
  // 2. Marketplace SKUs mapped to the product, filtered by grade when provided
  const skusToMatch = [sku]

  const mappings = await prisma.productGradeMarketplaceSku.findMany({
    where: {
      product: { sku },
      ...(gradeId ? { gradeId } : {}),
    },
    select: { sellerSku: true },
  })
  for (const m of mappings) {
    if (!skusToMatch.includes(m.sellerSku)) skusToMatch.push(m.sellerSku)
  }

  // Find the oldest AWAITING_VERIFICATION order where:
  // 1. Has an item with matching sellerSku (direct or via marketplace mapping)
  // 2. Single-qty order (only one item with qty 1)
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

  // Filter to single-qty orders (total quantityOrdered across all items = 1)
  const match = candidates.find(order => {
    const totalQty = order.items.reduce((sum, item) => sum + item.quantityOrdered, 0)
    return totalQty === 1
  })

  return NextResponse.json({ match: match ?? null })
}
