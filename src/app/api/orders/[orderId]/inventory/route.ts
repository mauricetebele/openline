/**
 * GET /api/orders/[orderId]/inventory
 * Returns inventory locations and quantities for each SKU in the order.
 * Used by the Process Order modal to let users select where to reserve stock from.
 * If a sellerSku maps to a ProductGradeMarketplaceSku, only grade-matching inventory is returned.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

interface InventoryLocation {
  locationId: string
  locationName: string
  warehouseName: string
  qty: number
  gradeId: string | null
  gradeName: string | null
  isFinishedGoods: boolean
}

interface OrderItemInventory {
  orderItemId: string
  sellerSku: string | null
  title: string | null
  quantityOrdered: number
  productId: string | null
  productDescription: string | null
  totalQtyAvailable: number
  gradeId: string | null
  gradeName: string | null
  locations: InventoryLocation[]
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: { items: { orderBy: { sellerSku: 'asc' } } },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const result: OrderItemInventory[] = []

  for (const item of order.items) {
    if (!item.sellerSku) {
      result.push({
        orderItemId: item.id,
        sellerSku: null,
        title: item.title,
        quantityOrdered: item.quantityOrdered,
        productId: null,
        productDescription: null,
        totalQtyAvailable: 0,
        gradeId: null,
        gradeName: null,
        locations: [],
      })
      continue
    }

    // Grade constraint: prefer the OrderItem's explicit gradeId (set during SKU edit),
    // then fall back to ProductGradeMarketplaceSku mapping
    let gradeId:   string | null = item.gradeId ?? null
    let gradeName: string | null = null

    if (gradeId) {
      const g = await prisma.grade.findUnique({ where: { id: gradeId }, select: { grade: true } })
      gradeName = g?.grade ?? null
    }

    const msku = await prisma.productGradeMarketplaceSku.findFirst({
      where: { sellerSku: item.sellerSku },
      include: { grade: true, product: true },
    })

    if (!gradeId && msku?.gradeId) {
      gradeId   = msku.gradeId
      gradeName = msku.grade?.grade ?? null
    }

    // Try exact product match first, then fall back to grade's product
    let product = await prisma.product.findUnique({
      where: { sku: item.sellerSku },
      include: {
        inventoryItems: {
          where: {
            qty: { gt: 0 },
            ...(gradeId ? { gradeId } : {}),
          },
          include: { location: { include: { warehouse: true } }, grade: true },
          orderBy: { qty: 'desc' },
        },
      },
    })

    // If no exact match but we have an MSKU mapping, look up the product
    if (!product && msku) {
      product = await prisma.product.findUnique({
        where: { id: msku.productId },
        include: {
          inventoryItems: {
            where: {
              qty: { gt: 0 },
              ...(gradeId ? { gradeId } : {}),
            },
            include: { location: { include: { warehouse: true } }, grade: true },
            orderBy: { qty: 'desc' },
          },
        },
      })
    }

    const locations: InventoryLocation[] = (product?.inventoryItems ?? []).map(inv => ({
      locationId:      inv.locationId,
      locationName:    inv.location.name,
      warehouseName:   inv.location.warehouse.name,
      qty:             inv.qty,
      gradeId:         inv.gradeId ?? null,
      gradeName:       inv.grade?.grade ?? null,
      isFinishedGoods: inv.location.isFinishedGoods,
    }))

    result.push({
      orderItemId:        item.id,
      sellerSku:          item.sellerSku,
      title:              item.title,
      quantityOrdered:    item.quantityOrdered,
      productId:          product?.id ?? null,
      productDescription: product?.description ?? null,
      totalQtyAvailable:  locations.reduce((s, l) => s + l.qty, 0),
      gradeId,
      gradeName,
      locations,
    })
  }

  return NextResponse.json({ orderId: order.id, items: result })
}
