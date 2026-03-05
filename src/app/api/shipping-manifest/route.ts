import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { detectCarrier } from '@/lib/ups-tracking'

const CARRIER_DISPLAY: Record<string, string> = {
  UPS: 'UPS',
  USPS: 'USPS',
  FEDEX: 'FedEx',
  AMZL: 'Amazon Logistics',
}

/** Resolve a human-readable carrier name from raw fields + tracking number */
function resolveCarrier(rawCarrier: string | null, tracking: string | null): string | null {
  // If we already have a clean carrier name (not a generic placeholder), use it
  if (rawCarrier && !/buy.shipping|amazon_buy/i.test(rawCarrier)) return rawCarrier

  // Detect from tracking number
  if (tracking) {
    const detected = detectCarrier(tracking)
    if (detected !== 'UNKNOWN') return CARRIER_DISPLAY[detected] ?? detected
  }

  return rawCarrier
}

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

  const rows = orders.map((o) => {
    const tracking = o.label?.trackingNumber || o.shipTracking || null
    const rawCarrier = o.label?.carrier || o.shipCarrier || null
    return {
      id: o.id,
      olmNumber: o.olmNumber,
      amazonOrderId: o.amazonOrderId,
      carrier: resolveCarrier(rawCarrier, tracking),
      serviceCode: o.label?.serviceCode || o.shipmentServiceLevel || null,
      shipDate: o.label?.createdAt || o.shippedAt || null,
      trackingNumber: tracking,
    }
  })

  return NextResponse.json(rows)
}
