import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || user.role !== 'VENDOR' || !user.vendorId)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get allowed location IDs (reuses ClientLocationAccess model)
  const access = await prisma.clientLocationAccess.findMany({
    where: { userId: user.dbId },
    select: { locationId: true },
  })
  const allowedLocationIds = access.map(a => a.locationId)
  if (allowedLocationIds.length === 0)
    return NextResponse.json({ data: [] })

  const { searchParams } = req.nextUrl
  const search  = searchParams.get('search')?.trim()
  const gradeId = searchParams.get('gradeId')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const productFilter: any = {
    inventorySerials: {
      some: {
        vendorId: user.vendorId,
        locationId: { in: allowedLocationIds },
        status: 'IN_STOCK',
      },
    },
  }
  if (search) {
    productFilter.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [items, reservationGroups, fbaReservationGroups, wholesaleReservationGroups] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: {
        locationId: { in: allowedLocationIds },
        ...(gradeId === 'none' ? { gradeId: null } : gradeId ? { gradeId } : {}),
        product: productFilter,
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
        locationId: { in: allowedLocationIds },
        order: { workflowStatus: { in: ['PROCESSING', 'AWAITING_VERIFICATION'] } },
      },
      _sum: { qtyReserved: true },
    }),
    prisma.fbaInventoryReservation.groupBy({
      by: ['productId', 'locationId', 'gradeId'],
      where: {
        locationId: { in: allowedLocationIds },
        fbaShipment: { status: { notIn: ['SHIPPED', 'CANCELLED'] } },
      },
      _sum: { qtyReserved: true },
    }),
    prisma.salesOrderInventoryReservation.groupBy({
      by: ['productId', 'locationId', 'gradeId'],
      where: {
        locationId: { in: allowedLocationIds },
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
