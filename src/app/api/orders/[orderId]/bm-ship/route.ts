/**
 * POST /api/orders/[orderId]/bm-ship
 *
 * Ships a BackMarket order by calling the BM API per orderline with:
 *   { order_id, new_state: 3, sku, tracking_number, shipper, imei }
 *
 * Body (optional):
 *   { carrier?: string, tracking?: string }
 *   When provided, uses these instead of requiring a ShipStation label.
 *
 * Prerequisites:
 *  - Order must be BackMarket (orderSource === 'backmarket')
 *  - Must have tracking: either from body or from a saved label
 *  - All order items must have bmSerials filled (one per unit)
 *
 * On success, updates workflowStatus → SHIPPED.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from '@/lib/backmarket/client'

export const dynamic = 'force-dynamic'

/** Map ShipStation carrier codes to clean names BackMarket recognizes */
const CARRIER_NAME_MAP: Record<string, string> = {
  stamps_com:       'USPS',
  usps:             'USPS',
  ups:              'UPS',
  ups_walleted:     'UPS',
  fedex:            'FedEx',
  dhl_express:      'DHL',
  dhl_ecommerce:    'DHL',
  ontrac:           'OnTrac',
  amazon_buy_shipping: 'Amazon',
}
function carrierDisplayName(code: string | null | undefined): string | undefined {
  if (!code) return undefined
  return CARRIER_NAME_MAP[code.toLowerCase()] ?? code
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      label: { select: { trackingNumber: true, carrier: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.orderSource !== 'backmarket') {
    return NextResponse.json({ error: 'Not a BackMarket order' }, { status: 400 })
  }

  // Accept manual carrier/tracking from body, fall back to label
  const body = await req.json().catch(() => ({})) as { carrier?: string; tracking?: string }
  const manualTracking = body.tracking?.trim()
  const manualCarrier  = body.carrier?.trim()

  const trackingNumber = manualTracking || order.label?.trackingNumber
  if (!trackingNumber) {
    return NextResponse.json({ error: 'No tracking number — provide carrier + tracking or purchase a label first' }, { status: 400 })
  }
  const shipper = manualCarrier
    ? (CARRIER_NAME_MAP[manualCarrier.toLowerCase()] ?? manualCarrier)
    : carrierDisplayName(order.label?.carrier)

  // Verify all items have serials
  const missingSerials = order.items.filter(
    i => (i.bmSerials?.length ?? 0) < i.quantityOrdered,
  )
  if (missingSerials.length > 0) {
    const names = missingSerials.map(i => i.title ?? i.sellerSku ?? i.id).join(', ')
    return NextResponse.json({
      error: `Missing serial numbers for: ${names}`,
    }, { status: 400 })
  }

  // Load BackMarket credentials
  const credential = await prisma.backMarketCredential.findFirst({
    where: { isActive: true },
    select: { apiKeyEnc: true },
  })
  if (!credential) {
    return NextResponse.json({ error: 'No active BackMarket credentials' }, { status: 400 })
  }

  const client = new BackMarketClient(decrypt(credential.apiKeyEnc))
  const bmOrderId = order.amazonOrderId

  try {
    // Call BackMarket API per orderline: POST /orders/{order_id}
    // with { order_id, new_state: 3, sku, tracking_number, shipper, imei }
    // If an item has multiple units (qty > 1), join IMEIs with commas.
    for (const item of order.items) {
      if (!item.sellerSku) {
        console.warn(`[bm-ship] Skipping item ${item.id} — no sellerSku`)
        continue
      }

      const imei = (item.bmSerials ?? []).join(',')

      console.log(
        '[bm-ship] order=%s sku=%s tracking=%s shipper=%s imei=%s',
        bmOrderId, item.sellerSku, trackingNumber, shipper, imei,
      )

      await client.post(`/orders/${bmOrderId}`, {
        order_id:        bmOrderId,
        new_state:       3,
        sku:             item.sellerSku,
        tracking_number: trackingNumber,
        ...(shipper ? { shipper } : {}),
        imei,
      })
    }

    // Release inventory reservations — qty was already decremented during processing
    await prisma.orderInventoryReservation.deleteMany({ where: { orderId } })

    // Mark order as shipped locally
    await prisma.order.update({
      where: { id: orderId },
      data: {
        workflowStatus: 'SHIPPED',
        orderStatus:    'Shipped',
      },
    })

    return NextResponse.json({ shipped: true, bmOrderId, trackingNumber })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[bm-ship] Failed for order ${bmOrderId}:`, message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
