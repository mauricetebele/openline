/**
 * GET /api/repeat-customers?limit=&search=
 * Marketplace (Amazon + BackMarket) buyers who have ordered more than once,
 * matched on ship-to name + postal. Returns each customer with their order count,
 * last-order date, a representative address, and the full list of their orders.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const key = (name: string | null, postal: string | null) => `${name ?? ''}|${postal ?? ''}`

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '1000', 10) || 1000, 5000)
  const search = req.nextUrl.searchParams.get('search')?.trim()

  // 1. The repeat (name + postal) pairs, newest-last-order first.
  const groups = await prisma.order.groupBy({
    by: ['shipToName', 'shipToPostal'],
    where: {
      orderSource: { in: ['amazon', 'backmarket'] },
      shipToName: search ? { contains: search, mode: 'insensitive' } : { not: null },
    },
    _count: { _all: true },
    _max: { purchaseDate: true },
    having: { shipToName: { _count: { gt: 1 } } },
    orderBy: { _max: { purchaseDate: 'desc' } },
    take: limit,
  })

  if (groups.length === 0) return NextResponse.json({ customers: [] })

  // 2. Fetch every order for those buyers (bounded to repeat names) for the
  //    address + the expandable per-order list.
  const names = Array.from(new Set(groups.map(g => g.shipToName).filter((n): n is string => !!n)))
  const orders = await prisma.order.findMany({
    where: { orderSource: { in: ['amazon', 'backmarket'] }, shipToName: { in: names } },
    select: {
      shipToName: true, shipToPostal: true, shipToAddress1: true, shipToAddress2: true,
      shipToCity: true, shipToState: true,
      amazonOrderId: true, olmNumber: true, orderSource: true,
      purchaseDate: true, orderTotal: true, currency: true, workflowStatus: true,
    },
    orderBy: { purchaseDate: 'desc' },
  })

  const ordersByKey = new Map<string, typeof orders>()
  for (const o of orders) {
    const k = key(o.shipToName, o.shipToPostal)
    const arr = ordersByKey.get(k) ?? []
    arr.push(o)
    ordersByKey.set(k, arr)
  }

  const customers = groups.map(g => {
    const k = key(g.shipToName, g.shipToPostal)
    const list = ordersByKey.get(k) ?? []
    const latest = list[0] // already sorted desc
    const addressParts = [
      latest?.shipToAddress1, latest?.shipToAddress2,
      [latest?.shipToCity, latest?.shipToState].filter(Boolean).join(', '),
      g.shipToPostal,
    ].filter(Boolean)
    return {
      name: g.shipToName,
      postal: g.shipToPostal,
      address: addressParts.join(', ') || '—',
      orderCount: g._count._all,
      lastOrderDate: g._max.purchaseDate,
      orders: list.map(o => ({
        amazonOrderId: o.amazonOrderId,
        olmNumber: o.olmNumber,
        orderSource: o.orderSource,
        purchaseDate: o.purchaseDate,
        orderTotal: o.orderTotal != null ? Number(o.orderTotal) : null,
        currency: o.currency,
        workflowStatus: o.workflowStatus,
      })),
    }
  })

  return NextResponse.json({ customers })
}
