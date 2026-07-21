/**
 * GET /api/inventory/mp-sales
 *
 * Marketplace (Amazon + BackMarket) order-level sales detail for one product
 * (optionally one grade), over a time window — powers the "MP Sales Recent"
 * hover modal in the inventory grid. Read-only.
 *
 * Query params:
 *   productId  (required)
 *   gradeId    optional — a grade id, or "none" for the null-grade row.
 *              Omit for all grades of the product.
 *   days       optional preset window (e.g. 3, 7, 30). Default 3.
 *   from,to    optional custom range (YYYY-MM-DD); overrides `days` when both set.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const CANCELLED = ['Canceled', 'Cancelled']

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const productId = sp.get('productId')?.trim()
  if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })

  const gradeParam = sp.get('gradeId')
  const daysRaw = parseInt(sp.get('days') ?? '3', 10)
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 3
  const fromStr = sp.get('from')
  const toStr = sp.get('to')

  // Resolve the time window.
  let from: Date
  let to: Date
  if (fromStr && toStr) {
    from = new Date(`${fromStr}T00:00:00.000Z`)
    to = new Date(`${toStr}T23:59:59.999Z`)
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json({ error: 'Invalid from/to dates' }, { status: 400 })
    }
  } else {
    to = new Date()
    from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  }

  // Seller SKUs mapping to this product (+ optional grade).
  const gradeWhere =
    gradeParam == null ? {} : gradeParam === 'none' ? { gradeId: null } : { gradeId: gradeParam }
  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: { productId, ...gradeWhere },
    select: { sellerSku: true },
  })
  const sellerSkus = Array.from(new Set(mskus.map(m => m.sellerSku).filter(Boolean)))
  if (sellerSkus.length === 0) {
    return NextResponse.json({ units: 0, orders: [] })
  }

  const rows = await prisma.orderItem.findMany({
    where: {
      sellerSku: { in: sellerSkus },
      order: {
        orderSource: { in: ['amazon', 'backmarket'] },
        purchaseDate: { gte: from, lte: to },
        orderStatus: { notIn: CANCELLED },
      },
    },
    select: {
      itemPrice: true,
      quantityOrdered: true,
      sellerSku: true,
      order: { select: { amazonOrderId: true, olmNumber: true, orderSource: true, purchaseDate: true } },
    },
    orderBy: { order: { purchaseDate: 'desc' } },
    take: 2000,
  })

  const orders = rows.map(r => ({
    orderId: r.order.amazonOrderId,
    olmNumber: r.order.olmNumber,
    marketplace: r.order.orderSource, // 'amazon' | 'backmarket'
    sellerSku: r.sellerSku,
    price: r.itemPrice != null ? Number(r.itemPrice) : null,
    qty: r.quantityOrdered,
    date: r.order.purchaseDate,
  }))
  const units = orders.reduce((s, o) => s + o.qty, 0)

  return NextResponse.json({ units, orders })
}
