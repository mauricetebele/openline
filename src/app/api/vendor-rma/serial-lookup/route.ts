import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sn = req.nextUrl.searchParams.get('sn')?.trim()
  if (!sn) return NextResponse.json({ error: 'sn is required' }, { status: 400 })

  const inventorySerial = await prisma.inventorySerial.findFirst({
    where: { serialNumber: { equals: sn, mode: 'insensitive' } },
    include: {
      product: { select: { id: true, sku: true, description: true, isSerializable: true } },
    },
  })

  if (!inventorySerial) {
    return NextResponse.json({ found: false })
  }

  return NextResponse.json({
    found: true,
    product: inventorySerial.product,
    inventoryStatus: inventorySerial.status,
  })
}
