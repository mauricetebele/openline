import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  const start = new Date(startDate + 'T00:00:00.000Z')
  const end = new Date(endDate + 'T23:59:59.999Z')

  const orders = await prisma.order.findMany({
    where: {
      workflowStatus: 'SHIPPED',
      OR: [
        { label: { createdAt: { gte: start, lte: end } } },
        { shippedAt: { gte: start, lte: end } },
      ],
    },
    select: {
      id: true,
      olmNumber: true,
      amazonOrderId: true,
      shipCarrier: true,
      shipTracking: true,
      shipmentServiceLevel: true,
      shippedAt: true,
      label: {
        select: {
          trackingNumber: true,
          carrier: true,
          serviceCode: true,
          createdAt: true,
        },
      },
    },
    orderBy: [
      { shippedAt: 'desc' },
      { olmNumber: 'desc' },
    ],
  })

  const rows = orders.map((o) => ({
    id: o.id,
    olmNumber: o.olmNumber,
    amazonOrderId: o.amazonOrderId,
    carrier: o.label?.carrier || o.shipCarrier || null,
    serviceCode: o.label?.serviceCode || o.shipmentServiceLevel || null,
    shipDate: o.label?.createdAt || o.shippedAt || null,
    trackingNumber: o.label?.trackingNumber || o.shipTracking || null,
  }))

  return NextResponse.json(rows)
}
