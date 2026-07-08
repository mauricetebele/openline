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

/** Normalize carrier to a standard name for filtering */
function normalizeCarrier(display: string | null): string | null {
  if (!display) return null
  const u = display.toUpperCase()
  if (u.includes('UPS')) return 'UPS'
  if (u.includes('FEDEX') || u.includes('FDX')) return 'FedEx'
  if (u.includes('USPS') || u.includes('US POSTAL') || u.includes('STAMPS')) return 'USPS'
  return display
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

  const [orders, wholesaleOrders] = await Promise.all([
    prisma.order.findMany({
      where: {
        workflowStatus: 'SHIPPED',
        fulfillmentChannel: { not: 'AFN' },
        OR: [
          { label: { createdAt: { gte: start, lte: end } } },
          { shippedAt: { gte: start, lte: end } },
        ],
      },
      select: {
        id: true,
        olmNumber: true,
        amazonOrderId: true,
        orderSource: true,
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
    }),
    prisma.salesOrder.findMany({
      where: {
        fulfillmentStatus: 'SHIPPED',
        shippedAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        orderNumber: true,
        invoiceNumber: true,
        shipCarrier: true,
        shipTracking: true,
        shippedAt: true,
        customer: { select: { companyName: true } },
      },
      orderBy: { shippedAt: 'desc' },
    }),
  ])

  const rows = [
    ...orders.map((o) => {
      const tracking = o.label?.trackingNumber || o.shipTracking || null
      const rawCarrier = o.label?.carrier || o.shipCarrier || null
      const carrier = resolveCarrier(rawCarrier, tracking)
      return {
        id: o.id,
        source: 'marketplace' as const,
        olmNumber: o.olmNumber,
        amazonOrderId: o.amazonOrderId,
        orderSource: o.orderSource,
        orderRef: null as string | null,
        customerName: null as string | null,
        carrier,
        carrierNorm: normalizeCarrier(carrier),
        serviceCode: o.label?.serviceCode || o.shipmentServiceLevel || null,
        shipDate: o.label?.createdAt || o.shippedAt || null,
        trackingNumber: tracking,
      }
    }),
    ...wholesaleOrders.map((so) => {
      const carrier = resolveCarrier(so.shipCarrier, so.shipTracking)
      return {
        id: so.id,
        source: 'wholesale' as const,
        olmNumber: null,
        amazonOrderId: null as string | null,
        orderSource: 'wholesale' as string,
        orderRef: so.invoiceNumber ?? so.orderNumber,
        customerName: so.customer.companyName,
        carrier,
        carrierNorm: normalizeCarrier(carrier),
        serviceCode: null,
        shipDate: so.shippedAt,
        trackingNumber: so.shipTracking,
      }
    }),
  ].sort((a, b) => {
    const da = a.shipDate ? new Date(a.shipDate).getTime() : 0
    const db = b.shipDate ? new Date(b.shipDate).getTime() : 0
    return db - da
  })

  return NextResponse.json(rows)
}
