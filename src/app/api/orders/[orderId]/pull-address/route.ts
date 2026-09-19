/**
 * POST /api/orders/[orderId]/pull-address
 * Backfill an order's ship-to address from ShipStation (which retains it even
 * after Amazon purges buyer PII), persist it onto the order, and return it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: { orderId: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    select: { id: true, amazonOrderId: true, shipToAddress1: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.shipToAddress1) {
    return NextResponse.json({ ok: true, alreadyHad: true })
  }

  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true }, orderBy: { createdAt: 'asc' },
    select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
  })
  if (!account) return NextResponse.json({ error: 'No active ShipStation account connected' }, { status: 400 })

  const client = new ShipStationClient(
    decrypt(account.apiKeyEnc),
    account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '',
    account.v2ApiKeyEnc ? decrypt(account.v2ApiKeyEnc) : null,
  )

  // 1) the ShipStation order record; 2) fall back to the purchased shipment's
  //    ship-to (retained even when the order's buyer PII is scrubbed).
  let a: { name?: string | null; street1?: string | null; street2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null; phone?: string | null } | null = null
  let foundOrder = false
  try {
    const ssOrder = await client.findOrderByNumber(order.amazonOrderId)
    foundOrder = !!ssOrder
    if (ssOrder?.shipTo?.street1) a = ssOrder.shipTo
    if (!a) a = await client.findShipmentAddressByOrderNumber(order.amazonOrderId)
  } catch (e) {
    return NextResponse.json({ error: `ShipStation lookup failed: ${e instanceof Error ? e.message : 'error'}` }, { status: 502 })
  }

  if (!a || !a.street1) {
    return NextResponse.json({
      error: foundOrder
        ? 'ShipStation has this order but no saved address (buyer info was scrubbed).'
        : 'This order was not found in ShipStation (no order or shipment matches its Amazon Order ID).',
    }, { status: 404 })
  }

  const data = {
    shipToName: a.name ?? null,
    shipToAddress1: a.street1 ?? null,
    shipToAddress2: a.street2 ?? null,
    shipToCity: a.city ?? null,
    shipToState: a.state ?? null,
    shipToPostal: a.postalCode ?? null,
    shipToCountry: a.country ?? 'US',
    shipToPhone: a.phone ?? null,
  }
  await prisma.order.update({ where: { id: order.id }, data })

  return NextResponse.json({ ok: true, address: data })
}
