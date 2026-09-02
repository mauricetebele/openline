/**
 * GET /api/backmarket/order-lookup?orderId=72909015
 *
 * Fetches a BackMarket order directly from the BackMarket API and returns the
 * carrier/shipping details BackMarket recorded, alongside what our system sent
 * (the label carrier + the ship-time serial-history note). Diagnostic tool to
 * see, from BackMarket's side, what carrier ended up on an order.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from '@/lib/backmarket/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orderId = req.nextUrl.searchParams.get('orderId')?.trim()
  if (!orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 })

  const credential = await prisma.backMarketCredential.findFirst({
    where: { isActive: true },
    select: { apiKeyEnc: true },
  })
  if (!credential) return NextResponse.json({ error: 'No active BackMarket credentials' }, { status: 400 })

  const client = new BackMarketClient(decrypt(credential.apiKeyEnc))

  // ── What BackMarket recorded ─────────────────────────────────────────────
  let bmOrder: Record<string, unknown>
  try {
    bmOrder = await client.get<Record<string, unknown>>(`/orders/${orderId}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `BackMarket lookup failed: ${msg}` }, { status: 502 })
  }

  const orderlines = Array.isArray(bmOrder.orderlines) ? (bmOrder.orderlines as Record<string, unknown>[]) : []
  const backmarket = {
    state: bmOrder.state,
    shipping_method: bmOrder.shipping_method ?? null,
    shipping_carrier: bmOrder.shipping_carrier ?? null,
    // Per-orderline shipping fields (names vary by BM API version — include all
    // shipping-ish keys so we can see exactly what BM stored).
    orderlines: orderlines.map(ol => {
      const shippingKeys: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(ol)) {
        if (/ship|carrier|track|tracking|shipper|method|state/i.test(k)) shippingKeys[k] = v
      }
      return { id: ol.id, listing: ol.listing, ...shippingKeys }
    }),
  }

  // ── What our system has / sent ───────────────────────────────────────────
  const order = await prisma.order.findFirst({
    where: { amazonOrderId: orderId, orderSource: 'backmarket' },
    select: {
      id: true, olmNumber: true, workflowStatus: true, orderStatus: true,
      shipCarrier: true, shipTracking: true, shippedAt: true,
      label: { select: { carrier: true, trackingNumber: true, serviceCode: true } },
    },
  })
  const shipNote = order
    ? (await prisma.serialHistory.findFirst({
        where: { orderId: order.id, eventType: 'SALE' },
        orderBy: { createdAt: 'desc' },
        select: { notes: true, createdAt: true },
      }))
    : null

  return NextResponse.json({
    orderId,
    backmarket,
    ourSystem: {
      olmNumber: order?.olmNumber ?? null,
      workflowStatus: order?.workflowStatus ?? null,
      labelCarrier: order?.label?.carrier ?? null,
      labelTracking: order?.label?.trackingNumber ?? null,
      labelService: order?.label?.serviceCode ?? null,
      shipCarrier: order?.shipCarrier ?? null,
      shipTracking: order?.shipTracking ?? null,
      shipNote: shipNote?.notes ?? null,
    },
  })
}
