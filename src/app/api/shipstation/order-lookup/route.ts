import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/shipstation/order-lookup?amazonOrderId=111-XXXXXXX-XXXXXXX
 *
 * Searches ShipStation for an order whose orderNumber matches the given Amazon
 * Order ID.  Returns:
 *   { found: true,  ssOrderId: number, orderStatus: string, shipTo: SSAddress }
 *   { found: false, error?: string }
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const amazonOrderId = req.nextUrl.searchParams.get('amazonOrderId')?.trim()
  if (!amazonOrderId) return NextResponse.json({ error: 'Missing amazonOrderId' }, { status: 400 })

  // ── Fast path: return locally-stored data if we already have ssOrderId + address ──
  const local = await prisma.order.findFirst({
    where: { amazonOrderId, ssOrderId: { not: null }, shipToCity: { not: null }, shipToState: { not: null }, shipToPostal: { not: null } },
    select: { ssOrderId: true, shipToName: true, shipToAddress1: true, shipToAddress2: true, shipToCity: true, shipToState: true, shipToPostal: true, shipToCountry: true, shipToPhone: true },
  })
  if (local?.ssOrderId && local.shipToCity && local.shipToState && local.shipToPostal) {
    return NextResponse.json({
      found: true,
      ssOrderId: local.ssOrderId,
      orderStatus: 'awaiting_shipment', // locally-enriched orders are always unshipped
      shipTo: {
        name: local.shipToName ?? '',
        street1: local.shipToAddress1 ?? '',
        street2: local.shipToAddress2 ?? '',
        city: local.shipToCity ?? '',
        state: local.shipToState ?? '',
        postalCode: local.shipToPostal ?? '',
        country: local.shipToCountry ?? 'US',
        phone: local.shipToPhone ?? '',
      },
    })
  }

  // ── Slow path: query ShipStation API ──────────────────────────────────────
  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!account) return NextResponse.json({ error: 'No ShipStation account connected' }, { status: 404 })

  const client = new ShipStationClient(decrypt(account.apiKeyEnc), account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '')

  try {
    const ssOrder = await client.findOrderByNumber(amazonOrderId)
    if (!ssOrder) {
      return NextResponse.json({ found: false })
    }

    // Persist ssOrderId + address on the local Order record for the fast path next time
    if (ssOrder.shipTo) {
      prisma.order.updateMany({
        where: { amazonOrderId },
        data: {
          ssOrderId: ssOrder.orderId,
          shipToName: ssOrder.shipTo.name ?? null,
          shipToAddress1: ssOrder.shipTo.street1 ?? null,
          shipToAddress2: ssOrder.shipTo.street2 ?? null,
          shipToCity: ssOrder.shipTo.city ?? null,
          shipToState: ssOrder.shipTo.state ?? null,
          shipToPostal: ssOrder.shipTo.postalCode ?? null,
          shipToCountry: ssOrder.shipTo.country ?? null,
          shipToPhone: ssOrder.shipTo.phone ?? null,
        },
      }).catch(() => {})
    } // best-effort, don't block the response

    return NextResponse.json({
      found:       true,
      ssOrderId:   ssOrder.orderId,
      orderStatus: ssOrder.orderStatus,
      shipTo:      ssOrder.shipTo,
    })
  } catch (err) {
    return NextResponse.json(
      { found: false, error: err instanceof Error ? err.message : 'Lookup failed' },
      { status: 502 },
    )
  }
}
