/**
 * POST /api/sync-commissions — Manual trigger for commission sync
 * Accepts { orderIds: string[] } to sync specific orders.
 * Streams SSE progress events: data: { synced, total }
 */
export const maxDuration = 300

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { syncAmazonCommissions } from '@/lib/amazon/sync-commissions'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const body = await req.json().catch(() => ({}))
  const orderIds: string[] = body.orderIds ?? []

  if (orderIds.length === 0) {
    return new Response(JSON.stringify({ error: 'No orders selected' }), { status: 400 })
  }

  // Look up the selected orders to know their sources and amazonOrderIds
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, orderSource: true, amazonOrderId: true, accountId: true, orderTotal: true },
  })

  const total = orders.length
  let synced = 0

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      send({ synced: 0, total })

      // Group Amazon orders by account
      const amazonByAccount = new Map<string, typeof orders>()
      for (const order of orders) {
        if (order.orderSource === 'amazon' && order.accountId) {
          const list = amazonByAccount.get(order.accountId) ?? []
          list.push(order)
          amazonByAccount.set(order.accountId, list)
        }
      }

      // Sync Amazon commissions per account, filtering to only selected order IDs
      for (const [accountId, accountOrders] of Array.from(amazonByAccount.entries())) {
        try {
          const end = new Date(Date.now() - 5 * 60 * 1000)
          const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000)
          const selectedAmazonOrderIds = new Set<string | null>(accountOrders.map((o: typeof orders[number]) => o.amazonOrderId))

          await syncAmazonCommissions(accountId, start, end, selectedAmazonOrderIds)

          synced += accountOrders.length
          send({ synced, total })
        } catch {
          // Still count as processed even if failed
          synced += accountOrders.length
          send({ synced, total })
        }
      }

      // Sync BackMarket orders (flat 12%)
      const BACKMARKET_RATE = 0.12
      const bmOrders = orders.filter(o => o.orderSource === 'backmarket')
      for (const order of bmOrders) {
        try {
          const orderTotal = Number(order.orderTotal ?? 0)
          const commission = Math.round(orderTotal * BACKMARKET_RATE * 100) / 100
          await prisma.order.update({
            where: { id: order.id },
            data: { marketplaceCommission: commission, commissionSyncedAt: new Date() },
          })
        } catch { /* skip */ }
        synced++
        send({ synced, total })
      }

      // Wholesale orders — commission is 0
      const wholesaleOrders = orders.filter(o => o.orderSource === 'wholesale')
      for (const order of wholesaleOrders) {
        try {
          await prisma.order.update({
            where: { id: order.id },
            data: { marketplaceCommission: 0, commissionSyncedAt: new Date() },
          })
        } catch { /* skip */ }
        synced++
        send({ synced, total })
      }

      send({ synced, total, done: true })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
