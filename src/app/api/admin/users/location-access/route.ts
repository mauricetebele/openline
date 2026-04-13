import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

// GET ?userId= — returns current location access for a user
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || user.role !== 'ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId)
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  const access = await prisma.clientLocationAccess.findMany({
    where: { userId },
    include: {
      location: {
        include: { warehouse: { select: { id: true, name: true } } },
      },
    },
    orderBy: [
      { location: { warehouse: { name: 'asc' } } },
      { location: { name: 'asc' } },
    ],
  })

  return NextResponse.json({
    data: access.map(a => ({
      id: a.id,
      locationId: a.locationId,
      locationName: a.location.name,
      warehouseId: a.location.warehouse.id,
      warehouseName: a.location.warehouse.name,
    })),
  })
}

// PUT { userId, locationIds[] } — replaces all access
export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || user.role !== 'ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { userId, locationIds } = body as { userId?: string; locationIds?: string[] }

  if (!userId)
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  if (!Array.isArray(locationIds))
    return NextResponse.json({ error: 'locationIds must be an array' }, { status: 400 })

  await prisma.$transaction([
    prisma.clientLocationAccess.deleteMany({ where: { userId } }),
    ...(locationIds.length > 0
      ? [prisma.clientLocationAccess.createMany({
          data: locationIds.map(locationId => ({ userId, locationId })),
          skipDuplicates: true,
        })]
      : []),
  ])

  return NextResponse.json({ ok: true, count: locationIds.length })
}
