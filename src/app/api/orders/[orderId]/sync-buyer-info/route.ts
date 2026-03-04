/**
 * POST /api/orders/[orderId]/sync-buyer-info
 *
 * Looks up the order in ShipStation by its Amazon Order ID and overwrites
 * the internal order record's ship-to fields with the data ShipStation holds.
 *
 * Returns the updated address fields so the caller can refresh its UI state
 * without a full re-fetch.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Resolve the order ────────────────────────────────────────────────────────
  const order = await prisma.order.findUnique({
    where:  { id: params.orderId },
    select: { id: true, amazonOrderId: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // ── Get active ShipStation account ──────────────────────────────────────────
  const account = await prisma.shipStationAccount.findFirst({
    where:   { isActive: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!account) {
    return NextResponse.json({ error: 'No ShipStation account connected' }, { status: 404 })
  }

  // ── Look up order in ShipStation ────────────────────────────────────────────
  const client = new ShipStationClient(
    decrypt(account.apiKeyEnc),
    account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '',
  )

  let ssOrder
  try {
    ssOrder = await client.findOrderByNumber(order.amazonOrderId)
  } catch (err) {
    return NextResponse.json(
      { error: `ShipStation lookup failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }

  if (!ssOrder) {
    return NextResponse.json(
      { error: `Order ${order.amazonOrderId} not found in ShipStation` },
      { status: 404 },
    )
  }

  const { shipTo } = ssOrder

  // ── Persist buyer info to internal order record ─────────────────────────────
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      shipToName:     shipTo.name     || null,
      shipToAddress1: shipTo.street1  || null,
      shipToAddress2: shipTo.street2  || null,
      shipToCity:     shipTo.city     || null,
      shipToState:    shipTo.state    || null,
      shipToPostal:   shipTo.postalCode || null,
      shipToCountry:  shipTo.country  || null,
      shipToPhone:    shipTo.phone    || null,
    },
    select: {
      shipToName:     true,
      shipToAddress1: true,
      shipToAddress2: true,
      shipToCity:     true,
      shipToState:    true,
      shipToPostal:   true,
      shipToCountry:  true,
      shipToPhone:    true,
    },
  })

  return NextResponse.json({ success: true, shipTo: updated })
}
