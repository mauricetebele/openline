import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const warehouseId = searchParams.get('warehouseId')
  const locationId  = searchParams.get('locationId')
  const search      = searchParams.get('search')?.trim()

  const [items, reservationGroups] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: {
        ...(locationId  ? { locationId } : {}),
        ...(warehouseId ? { location: { warehouseId } } : {}),
        ...(search
          ? {
              OR: [
                { product: { description: { contains: search, mode: 'insensitive' } } },
                { product: { sku: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        product:  { select: { id: true, description: true, sku: true, isSerializable: true } },
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
        order: { workflowStatus: { in: ['PROCESSING', 'AWAITING_VERIFICATION'] } },
      },
      _sum: { qtyReserved: true },
    }),
  ])

  // Build lookup: `${productId}:${locationId}:${gradeId ?? ''}` → reserved qty
  const reservedMap = new Map<string, number>()
  for (const r of reservationGroups) {
    const key = `${r.productId}:${r.locationId}:${r.gradeId ?? ''}`
    reservedMap.set(key, r._sum.qtyReserved ?? 0)
  }

  const data = items
    .map(item => {
      const key      = `${item.productId}:${item.locationId}:${item.gradeId ?? ''}`
      const reserved = reservedMap.get(key) ?? 0
      const onHand   = item.qty + reserved
      return { ...item, reserved, onHand }
    })
    .filter(item => item.onHand > 0)

  return NextResponse.json({ data })
}
