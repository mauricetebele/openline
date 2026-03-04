/**
 * GET /api/orders/match-by-sku?sku=X&accountId=Y
 * Finds the oldest single-qty AWAITING_VERIFICATION order that needs the given SKU.
 * Excludes BackMarket orders.
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
  if (!sku) return NextResponse.json({ error: 'Missing sku parameter' }, { status: 400 })
  if (!accountId) return NextResponse.json({ error: 'Missing accountId parameter' }, { status: 400 })

  // Find the oldest AWAITING_VERIFICATION order where:
  // 1. orderSource is NOT 'backmarket'
  // 2. Has an item with matching sellerSku
  // 3. Single-qty order (only one item with qty 1)
  const candidates = await prisma.order.findMany({
    where: {
      accountId,
      workflowStatus: 'AWAITING_VERIFICATION',
      orderSource: { not: 'backmarket' },
      items: { some: { sellerSku: sku } },
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
