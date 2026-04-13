import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || user.role !== 'CLIENT')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get allowed location IDs for this client user
  const access = await prisma.clientLocationAccess.findMany({
    where: { userId: user.dbId },
    select: { locationId: true },
  })
  const allowedLocationIds = access.map(a => a.locationId)
  if (allowedLocationIds.length === 0)
    return NextResponse.json({ data: [] })

  const { searchParams } = req.nextUrl
  const search      = searchParams.get('search')?.trim()
  const warehouseId = searchParams.get('warehouseId')
  const locationId  = searchParams.get('locationId')
  const gradeId     = searchParams.get('gradeId')

  // If client requests a specific location, ensure it's in their allowed list
  const locationFilter = locationId
    ? (allowedLocationIds.includes(locationId) ? [locationId] : [])
    : allowedLocationIds

  if (locationFilter.length === 0)
    return NextResponse.json({ data: [] })

  const [items, reservationGroups, fbaReservationGroups, wholesaleReservationGroups] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: {
        locationId: { in: locationFilter },
        ...(warehouseId ? { location: { warehouseId } } : {}),
        ...(gradeId === 'none' ? { gradeId: null } : gradeId ? { gradeId } : {}),
        ...(search
          ? {
              OR: [
                { product: { description: { contains: search, mode: 'insensitive' as const } } },
                { product: { sku: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      include: {
        product:  { select: { description: true, sku: true } },
        location: { include: { warehouse: { select: { id: true, name: true } } } },
        grade:    { select: { id: true, grade: true, description: true } },
      },
      orderBy: [
        { location: { warehouse: { name: 'asc' } } },
        { location: { name: 'asc' } },
        { product: { description: 'asc' } },
        { grade: { sortOrder: 'asc' } },
      ],
    }),
    prisma.orderInventoryReservation.groupBy({
      by: ['productId', 'locationId', 'gradeId'],
      where: {
        locationId: { in: locationFilter },
        order: { workflowStatus: { in: ['PROCESSING', 'AWAITING_VERIFICATION'] } },
      },
      _sum: { qtyReserved: true },
    }),
    prisma.fbaInventoryReservation.groupBy({
      by: ['productId', 'locationId', 'gradeId'],
      where: {
        locationId: { in: locationFilter },
        fbaShipment: { status: { notIn: ['SHIPPED', 'CANCELLED'] } },
      },
      _sum: { qtyReserved: true },
    }),
    prisma.salesOrderInventoryReservation.groupBy({
      by: ['productId', 'locationId', 'gradeId'],
      where: {
        locationId: { in: locationFilter },
        salesOrder: { fulfillmentStatus: { in: ['PROCESSING'] } },
      },
      _sum: { qtyReserved: true },
    }),
  ])

  // Build reservation maps
  const hardReservedMap = new Map<string, number>()
  for (const r of reservationGroups) {
    const key = `${r.productId}:${r.locationId}:${r.gradeId ?? ''}`
    hardReservedMap.set(key, (hardReservedMap.get(key) ?? 0) + (r._sum.qtyReserved ?? 0))
  }
  for (const r of fbaReservationGroups) {
    const key = `${r.productId}:${r.locationId}:${r.gradeId ?? ''}`
    hardReservedMap.set(key, (hardReservedMap.get(key) ?? 0) + (r._sum.qtyReserved ?? 0))
  }
  const wholesaleReservedMap = new Map<string, number>()
  for (const r of wholesaleReservationGroups) {
    const key = `${r.productId}:${r.locationId}:${r.gradeId ?? ''}`
    wholesaleReservedMap.set(key, (wholesaleReservedMap.get(key) ?? 0) + (r._sum.qtyReserved ?? 0))
  }

  // Compute available qty and return only safe fields
  const data = items
    .map(item => {
      const key = `${item.productId}:${item.locationId}:${item.gradeId ?? ''}`
      const hardReserved      = hardReservedMap.get(key) ?? 0
      const wholesaleReserved = wholesaleReservedMap.get(key) ?? 0
      const onHand    = item.qty + hardReserved
      const available = onHand - hardReserved - wholesaleReserved

      return {
        sku: item.product.sku,
        description: item.product.description,
        grade: item.grade?.grade ?? null,
        gradeDescription: item.grade?.description ?? null,
        location: item.location.name,
        warehouse: item.location.warehouse.name,
        warehouseId: item.location.warehouse.id,
        locationId: item.locationId,
        gradeId: item.gradeId,
        available,
      }
    })
    .filter(item => item.available > 0)

  return NextResponse.json({ data })
}
