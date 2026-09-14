/**
 * GET /api/chargeback-response?order=<amazonOrderId | OLM-#>
 * Builds the plain-text Amazon chargeback response for an order, auto-filling the
 * shipped confirmation, ship date, carrier, shipper link, and tracking number. The
 * return/refund/cancellation policy and return address are fixed company blocks.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { detectCarrier, trackingUrl } from '@/lib/tracking-utils'

export const dynamic = 'force-dynamic'

// Fixed company blocks (from the standard manual response).
const RETURN_POLICY = 'The customer may return their item for a full refund up to 90 days from date of purchase.'
const RETURN_ADDRESS = `Prime Mobility FBM Returns
20 Meridian Road
Unit 2
Eatontown, NJ 07724`

const CARRIER_NAME: Record<string, string> = {
  stamps_com: 'USPS', usps: 'USPS', ups: 'UPS', ups_walleted: 'UPS',
  fedex: 'FedEx', fedex_direct: 'FedEx', dhl_express: 'DHL', dhl_ecommerce: 'DHL', ontrac: 'OnTrac',
}

function carrierName(raw: string | null | undefined, tracking: string | null): string | null {
  if (raw) return CARRIER_NAME[raw.toLowerCase()] ?? raw
  if (tracking) {
    const d = detectCarrier(tracking)
    if (d === 'FEDEX') return 'FedEx'
    if (d === 'AMZL') return 'Amazon Logistics'
    if (d !== 'UNKNOWN') return d
  }
  return null
}

function fmtShipDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('order')?.trim()
  if (!q) return NextResponse.json({ error: 'order is required' }, { status: 400 })

  const olmRaw = q.toUpperCase().startsWith('OLM-') ? q.slice(4) : q
  const olmNum = /^\d+$/.test(olmRaw) ? Number(olmRaw) : NaN

  const order = await prisma.order.findFirst({
    where: {
      OR: [
        { amazonOrderId: { equals: q, mode: 'insensitive' } },
        ...(Number.isFinite(olmNum) && olmNum <= Number.MAX_SAFE_INTEGER ? [{ olmNumber: olmNum }] : []),
      ],
    },
    select: {
      id: true, amazonOrderId: true, olmNumber: true, workflowStatus: true, shippedAt: true, lastUpdateDate: true,
      shipCarrier: true, shipTracking: true,
      label: { select: { carrier: true, trackingNumber: true, createdAt: true } },
    },
  })
  if (!order) return NextResponse.json({ error: `No order found for "${q}"` }, { status: 404 })

  const tracking = order.label?.trackingNumber ?? order.shipTracking ?? null
  const carrier = carrierName(order.label?.carrier ?? order.shipCarrier, tracking)
  const shipDate = order.shippedAt ?? order.label?.createdAt ?? null
  const shipped = order.workflowStatus === 'SHIPPED' || !!tracking

  const warnings: string[] = []
  if (!shipped) warnings.push('This order is not marked shipped — verify before sending.')
  if (!tracking) warnings.push('No tracking number on file — fill in [TRACKING #] manually.')
  if (!carrier) warnings.push('Carrier unknown — fill in [CARRIER] manually.')
  if (!shipDate) warnings.push('No ship date on file — fill in [SHIP DATE] manually.')

  const carrierLabel = carrier ?? '[CARRIER]'
  const trackingLabel = tracking ?? '[TRACKING #]'
  const link = tracking ? trackingUrl(tracking) : '[SHIPPER TRACKING LINK]'

  const response = `Please see the requested information below:

-- Confirmation that the order was shipped.
Yes, this order was shipped

-- Date the order was shipped.
${shipDate ? fmtShipDate(shipDate) : '[SHIP DATE]'}

-- The name of the carrier used.
${carrierLabel}

-- Link of the shipper.
${link}

-- Delivery confirmation or tracking number along with signed proof of delivery, if available.
${carrierLabel} Tracking Number: ${trackingLabel}

-- Return and refund policy, as well as the cancellation policy.
${RETURN_POLICY}

-- The return shipping address that your customer should use in order to return the merchandise in exchange for credit.
${RETURN_ADDRESS}`

  return NextResponse.json({
    response,
    order: { amazonOrderId: order.amazonOrderId, olmNumber: order.olmNumber, shipped },
    warnings,
  })
}
