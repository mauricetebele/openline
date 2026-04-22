/**
 * POST /api/orders/[orderId]/confirm-backmarket
 *
 * Confirms (accepts) a BackMarket order by calling POST /ws/orders/{bm_order_id}
 * with { new_state: 2 } for each orderline SKU.
 * This tells BackMarket the merchant has accepted the order and will ship it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from '@/lib/backmarket/client'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params

  // Load the order and verify it's a BackMarket order
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.orderSource !== 'backmarket') {
    return NextResponse.json({ error: 'Not a BackMarket order' }, { status: 400 })
  }

  // Load BackMarket credentials
  const credential = await prisma.backMarketCredential.findFirst({
    where: { isActive: true },
    select: { apiKeyEnc: true },
  })
  if (!credential) {
    return NextResponse.json({ error: 'No active BackMarket credentials' }, { status: 400 })
  }

  const client = new BackMarketClient(decrypt(credential.apiKeyEnc))
  const bmOrderId = order.amazonOrderId // external BM order ID stored here

  try {
    // BackMarket requires per-orderline validation with the SKU
    // POST /orders/{order_id} with { order_id, new_state: 2, sku }
    const items = order.items ?? []
    if (items.length === 0) {
      return NextResponse.json({ error: 'Order has no items to confirm' }, { status: 400 })
    }

    // Fetch order from BackMarket to get the original listing SKUs.
    // Users may change sellerSku locally (SKU swap), but BM still
    // expects the original listing SKU for confirmation.
    const bmOrder = await client.get<{ orderlines?: Array<{ id?: number | string; listing?: string }> }>(`/orders/${bmOrderId}`)
    const bmSkuByLineId = new Map<string, string>()
    for (const line of bmOrder.orderlines ?? []) {
      if (line.id && line.listing) bmSkuByLineId.set(String(line.id), line.listing)
    }

    for (const item of items) {
      // Use the original BM listing SKU (matched by orderline ID),
      // falling back to the local sellerSku if not found
      const sku = bmSkuByLineId.get(item.orderItemId) ?? item.sellerSku
      if (!sku) {
        console.warn(`[confirm-backmarket] Skipping item ${item.id} — no SKU`)
        continue
      }
      await client.post(`/orders/${bmOrderId}`, {
        order_id: bmOrderId,
        new_state: 2,
        sku,
      })
    }

    // Update the local order status to reflect acceptance
    await prisma.order.update({
      where: { id: orderId },
      data: { orderStatus: 'Accepted' },
    })

    return NextResponse.json({ confirmed: true, bmOrderId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[confirm-backmarket] Failed for order ${bmOrderId}:`, message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
