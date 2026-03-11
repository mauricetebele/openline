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
          grade: { select: { grade: true } },
        },
      },
      serialAssignments: {
        include: {
          inventorySerial: { select: { binLocation: true } },
        },
      },
    },
  })

  // Collect product+location pairs that need bin lookups (reservations without serial assignments)
  const binLookups: { productId: string; locationId: string }[] = []
  for (const o of orders) {
    if (o.serialAssignments.length > 0) continue // already has serials — bins come from there
    for (const r of o.reservations) {
      binLookups.push({ productId: r.productId, locationId: r.locationId })
    }
  }

  // Batch-query bin locations from in-stock serials for reserved product+location pairs
  const binMap = new Map<string, Map<string, number>>() // "productId:locationId" → bin→count
  if (binLookups.length > 0) {
    const seen = new Set<string>()
    const uniquePairs = binLookups.filter(p => {
      const k = `${p.productId}:${p.locationId}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    // Query all at once using OR conditions
    const serials = await prisma.inventorySerial.findMany({
      where: {
        OR: uniquePairs.map(p => ({ productId: p.productId, locationId: p.locationId })),
        status: 'IN_STOCK',
        binLocation: { not: null },
      },
      select: { productId: true, locationId: true, binLocation: true },
    })
    for (const s of serials) {
      const key = `${s.productId}:${s.locationId}`
      let counts = binMap.get(key)
      if (!counts) { counts = new Map(); binMap.set(key, counts) }
      counts.set(s.binLocation!, (counts.get(s.binLocation!) ?? 0) + 1)
    }
  }

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

        // Bin locations from assigned serials (post-serialize)
        const itemSerials = o.serialAssignments.filter(sa => sa.orderItemId === item.id)
        const binCounts = new Map<string, number>()
        for (const sa of itemSerials) {
          const b = sa.inventorySerial.binLocation
          if (b) binCounts.set(b, (binCounts.get(b) ?? 0) + 1)
        }

        // Fallback: bin locations from in-stock serials at reserved product+location
        if (binCounts.size === 0) {
          for (const r of itemRes) {
            const key = `${r.productId}:${r.locationId}`
            const counts = binMap.get(key)
            if (counts) {
              counts.forEach((qty, bin) => {
                binCounts.set(bin, (binCounts.get(bin) ?? 0) + qty)
              })
            }
          }
        }

        const binLocations = Array.from(binCounts.entries()).map(([bin, qty]) => ({ bin, qty }))
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
            grade:         r.grade?.grade ?? null,
          })),
        }
      }),
    })),
  })
}
