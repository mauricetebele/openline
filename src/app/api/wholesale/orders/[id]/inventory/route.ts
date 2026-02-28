/**
 * GET /api/wholesale/orders/[id]/inventory
 * Returns inventory locations and quantities for each SKU in the sales order.
 * Inventory is grouped by grade when the product has grades.
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
}

interface OrderItemInventory {
  orderItemId: string
  sellerSku: string | null
  title: string | null
  quantityOrdered: number
  productId: string | null
  productDescription: string | null
  totalQtyAvailable: number
  locations: InventoryLocation[]
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const so = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: {
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          product: {
            include: {
              inventoryItems: {
                where: { qty: { gt: 0 } },
                include: { location: { include: { warehouse: true } }, grade: true },
                orderBy: [{ gradeId: 'asc' }, { qty: 'desc' }],
              },
            },
          },
        },
      },
    },
  })
  if (!so) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const result: OrderItemInventory[] = so.items.map(item => {
    const locations: InventoryLocation[] = (item.product?.inventoryItems ?? []).map(inv => ({
      locationId:    inv.locationId,
      locationName:  inv.location.name,
      warehouseName: inv.location.warehouse.name,
      qty:           inv.qty,
      gradeId:       inv.gradeId ?? null,
      gradeName:     inv.grade?.grade ?? null,
    }))

    return {
      orderItemId:        item.id,
      sellerSku:          item.sku,
      title:              item.title,
      quantityOrdered:    Math.round(Number(item.quantity)),
      productId:          item.productId ?? null,
      productDescription: item.product?.description ?? null,
      totalQtyAvailable:  locations.reduce((s, l) => s + l.qty, 0),
      locations,
    }
  })

  return NextResponse.json({ orderId: so.id, items: result })
}
