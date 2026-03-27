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

  const trackingNumber = manualTracking || order.label?.trackingNumber || order.shipTracking
  if (!trackingNumber) {
    return NextResponse.json({ error: 'No tracking number — provide carrier + tracking or purchase a label first' }, { status: 400 })
  }
  const shipper = manualCarrier
    ? (CARRIER_NAME_MAP[manualCarrier.toLowerCase()] ?? manualCarrier)
    : carrierDisplayName(order.label?.carrier) ?? order.shipCarrier

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
      const bmOrderlineId = item.orderItemId // BM orderline ID

      console.log(
        '[bm-ship] order=%s orderline=%s sku=%s tracking=%s shipper=%s imei=%s',
        bmOrderId, bmOrderlineId, item.sellerSku, trackingNumber, shipper, imei,
      )

      // Ship via order-level endpoint
      await client.post(`/orders/${bmOrderId}`, {
        order_id:        bmOrderId,
        new_state:       3,
        sku:             item.sellerSku,
        tracking_number: trackingNumber,
        ...(shipper ? { shipper } : {}),
        imei,
      })

      // Also update IMEI directly on the orderline (more reliable for already-shipped orders)
      if (imei && bmOrderlineId) {
        try {
          await client.post(`/orderlines/${bmOrderlineId}`, { imei })
        } catch (lineErr) {
          console.warn(`[bm-ship] orderline IMEI update failed for ${bmOrderlineId}:`, lineErr)
          // Non-fatal — the order-level call above may have already set it
        }
      }
    }

    // Collect all serial numbers from bmSerials across items
    const allBmSerials = order.items.flatMap(i => (i.bmSerials ?? []).map(s => s.trim())).filter(Boolean)

    // Mark inventory serials as OUT_OF_STOCK + create assignment records
    if (allBmSerials.length > 0) {
      const inventorySerials = await prisma.inventorySerial.findMany({
        where: { serialNumber: { in: allBmSerials } },
        select: { id: true, serialNumber: true, status: true },
      })

      const serialMap = new Map(inventorySerials.map(s => [s.serialNumber, s]))

      await prisma.$transaction(async (tx) => {
        for (const item of order.items) {
          for (const sn of (item.bmSerials ?? [])) {
            const serial = serialMap.get(sn.trim())
            if (!serial) continue
            if (serial.status === 'IN_STOCK') {
              await tx.inventorySerial.update({
                where: { id: serial.id },
                data: { status: 'OUT_OF_STOCK' },
              })
            }
            // Create assignment record (skip if already exists)
            const existing = await tx.orderSerialAssignment.findFirst({
              where: { orderId, inventorySerialId: serial.id },
            })
            if (!existing) {
              await tx.orderSerialAssignment.create({
                data: {
                  orderId,
                  orderItemId: item.id,
                  inventorySerialId: serial.id,
                },
              })
            }
          }
        }
      })
    }

    // Release inventory reservations — qty was already decremented during processing
    await prisma.orderInventoryReservation.deleteMany({ where: { orderId } })

    // Mark order as shipped locally + save carrier/tracking
    await prisma.order.update({
      where: { id: orderId },
      data: {
        workflowStatus: 'SHIPPED',
        orderStatus:    'Shipped',
        shipCarrier:    shipper ?? null,
        shipTracking:   trackingNumber,
        shippedAt:      new Date(),
      },
    })

    return NextResponse.json({ shipped: true, bmOrderId, trackingNumber })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[bm-ship] Failed for order ${bmOrderId}:`, message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
