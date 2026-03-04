import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const productId  = searchParams.get('productId')
  const locationId = searchParams.get('locationId')

  if (!productId || !locationId) {
    return NextResponse.json({ error: 'productId and locationId are required' }, { status: 400 })
  }

  try {
    const serials = await prisma.inventorySerial.findMany({
      where: { productId, locationId, status: 'IN_STOCK' },
      select: { id: true, serialNumber: true, binLocation: true, createdAt: true },
      orderBy: { serialNumber: 'asc' },
    })

    return NextResponse.json({ data: serials })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[GET /api/inventory/serials]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
