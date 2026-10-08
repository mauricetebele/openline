/**
 * GET /api/cs-cases/order-search?q= — typeahead for the New Case modal's Order ID
 * field. Matches marketplace orders by Amazon order id, OLM number, or buyer name.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && user.role !== 'MARKETPLACE_CS') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) return NextResponse.json({ data: [] })

  const olm = q.match(/^olm[- ]?(\d+)$/i)?.[1] ?? (/^\d{1,6}$/.test(q) ? q : null)
  const orders = await prisma.order.findMany({
    where: {
      orderSource: { in: ['amazon', 'backmarket'] },
      OR: [
        { amazonOrderId: { contains: q, mode: 'insensitive' } },
        { shipToName: { contains: q, mode: 'insensitive' } },
        ...(olm ? [{ olmNumber: Number(olm) }] : []),
      ],
    },
    orderBy: { purchaseDate: 'desc' },
    take: 10,
    select: { amazonOrderId: true, olmNumber: true, orderSource: true, shipToName: true, purchaseDate: true },
  })

  return NextResponse.json({
    data: orders.map(o => ({
      amazonOrderId: o.amazonOrderId,
      olmNumber: o.olmNumber,
      orderSource: o.orderSource,
      shipToName: o.shipToName,
      purchaseDate: o.purchaseDate,
    })),
  })
}
