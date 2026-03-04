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

    for (const item of items) {
      if (!item.sellerSku) {
        console.warn(`[confirm-backmarket] Skipping item ${item.id} — no sellerSku`)
        continue
      }
      await client.post(`/orders/${bmOrderId}`, {
        order_id: bmOrderId,
        new_state: 2,
        sku: item.sellerSku,
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
