/**
 * POST /api/orders/[orderId]/ss-pull
 *
 * Look up a single order in ShipStation by its amazonOrderId,
 * then update the local record with ssOrderId + shipping address.
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

  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    select: { id: true, amazonOrderId: true, ssOrderId: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!account) return NextResponse.json({ error: 'No ShipStation account connected' }, { status: 404 })

  const client = new ShipStationClient(decrypt(account.apiKeyEnc), account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '')

  const ssOrder = await client.findOrderByNumber(order.amazonOrderId)
  if (!ssOrder) {
    return NextResponse.json({ found: false, error: 'Order not found in ShipStation' })
  }

  // Build update data
  const data: Record<string, unknown> = { ssOrderId: ssOrder.orderId }
  if (ssOrder.shipTo) {
    const st = ssOrder.shipTo
    if (st.name)       data.shipToName     = st.name
    if (st.street1)    data.shipToAddress1 = st.street1
    if (st.street2)    data.shipToAddress2 = st.street2
    if (st.city)       data.shipToCity     = st.city
    if (st.state)      data.shipToState    = st.state
    if (st.postalCode) data.shipToPostal   = st.postalCode
    if (st.country)    data.shipToCountry  = st.country
    if (st.phone)      data.shipToPhone    = st.phone
  }

  await prisma.order.update({ where: { id: params.orderId }, data })

  return NextResponse.json({
    found: true,
    ssOrderId: ssOrder.orderId,
    addressUpdated: !!ssOrder.shipTo,
  })
}
