/**
 * GET /api/orders/pick-list?orderIds=id1,id2,...
 * Returns order + item + reservation data for the printable pick list.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('orderIds') ?? ''
  const orderIds = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (orderIds.length === 0) return NextResponse.json({ orders: [] })
  if (orderIds.length > 100) return NextResponse.json({ error: 'Max 100 orders per pick list' }, { status: 400 })

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    orderBy: { olmNumber: 'asc' },
    include: {
      items: { orderBy: { sellerSku: 'asc' } },
      reservations: {
        include: {
          location: {
            include: { warehouse: { select: { name: true } } },
          },
        },
      },
      serialAssignments: {
        include: {
          inventorySerial: { select: { binLocation: true } },
        },
      },
    },
  })

  return NextResponse.json({
    orders: orders.map(o => ({
      id:             o.id,
      olmNumber:      o.olmNumber,
      amazonOrderId:  o.amazonOrderId,
      workflowStatus: o.workflowStatus,
      shipToName:     o.shipToName,
      shipToCity:     o.shipToCity,
      shipToState:    o.shipToState,
      items: o.items.map(item => {
        const itemRes = o.reservations.filter(r => r.orderItemId === item.id)
        const itemSerials = o.serialAssignments.filter(sa => sa.orderItemId === item.id)
        const binLocations = Array.from(new Set(
          itemSerials
            .map(sa => sa.inventorySerial.binLocation)
            .filter((b): b is string => b != null)
        ))
        return {
          orderItemId:     item.id,
          sellerSku:       item.sellerSku,
          title:           item.title,
          quantityOrdered: item.quantityOrdered,
          binLocations,
          reservations: itemRes.map(r => ({
            locationName:  r.location.name,
            warehouseName: r.location.warehouse.name,
            qtyReserved:   r.qtyReserved,
          })),
        }
      }),
    })),
  })
}
