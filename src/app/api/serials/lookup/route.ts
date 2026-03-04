import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sn = req.nextUrl.searchParams.get('sn')?.trim()
  if (!sn) return NextResponse.json({ error: 'Serial number is required' }, { status: 400 })

  try {
    const serial = await prisma.inventorySerial.findFirst({
      where: { serialNumber: { equals: sn, mode: 'insensitive' } },
      include: {
        product:  { select: { id: true, description: true, sku: true } },
        grade:    { select: { id: true, grade: true } },
        location: { include: { warehouse: { select: { name: true } } } },
        history: {
          include: {
            receipt:       { select: { id: true, receivedAt: true } },
            purchaseOrder: { select: { id: true, poNumber: true, vendor: { select: { name: true } } } },
            order:         { select: { id: true, olmNumber: true, amazonOrderId: true, orderSource: true, shipToName: true, shipToCity: true, shipToState: true, orderTotal: true, currency: true, label: { select: { trackingNumber: true, carrier: true, serviceCode: true, shipmentCost: true } } } },
            location:      { select: { name: true, warehouse: { select: { name: true } } } },
            fromLocation:  { select: { name: true, warehouse: { select: { name: true } } } },
            fromProduct:   { select: { id: true, description: true, sku: true } },
            toProduct:     { select: { id: true, description: true, sku: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!serial) {
      return NextResponse.json({ error: `Serial number "${sn}" not found` }, { status: 404 })
    }

    return NextResponse.json(serial)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[serials/lookup] Prisma error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
