/**
 * POST /api/orders/enrich-addresses
 *
 * Finds any orders with a missing shipToPostal or shipToCity and fills them in
 * from ShipStation. Called fire-and-forget from the frontend after orders load,
 * so users never need to manually click "Sync from ShipStation" per order.
 *
 * Returns: { enriched: number, skipped: number }
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ssAccount = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { apiKeyEnc: true, apiSecretEnc: true },
  })
  if (!ssAccount) return NextResponse.json({ enriched: 0, skipped: 0 })

  const orders = await prisma.order.findMany({
    where: { fulfillmentChannel: { not: 'AFN' }, OR: [{ shipToPostal: null }, { shipToCity: null }] },
    select: { id: true, amazonOrderId: true },
  })
  if (orders.length === 0) return NextResponse.json({ enriched: 0, skipped: 0 })

  const client = new ShipStationClient(
    decrypt(ssAccount.apiKeyEnc),
    ssAccount.apiSecretEnc ? decrypt(ssAccount.apiSecretEnc) : '',
  )

  let enriched = 0
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i]
    try {
      const ssOrder = await client.findOrderByNumber(order.amazonOrderId)
      if (ssOrder?.shipTo) {
        const st = ssOrder.shipTo
        await prisma.order.update({
          where: { id: order.id },
          data: {
            shipToName:     st.name       || null,
            shipToAddress1: st.street1    || null,
            shipToAddress2: st.street2    || null,
            shipToCity:     st.city       || null,
            shipToState:    st.state      || null,
            shipToPostal:   st.postalCode || null,
            shipToCountry:  st.country    || null,
            shipToPhone:    st.phone      || null,
            // Also capture ship-by date if we have it and it's missing
            ...(ssOrder.shipByDate ? { latestShipDate: new Date(ssOrder.shipByDate) } : {}),
          },
        })
        enriched++
      }
    } catch {
      // best-effort — don't fail the whole batch for one order
    }
    if (i < orders.length - 1) await sleep(700)
  }

  return NextResponse.json({ enriched, skipped: orders.length - enriched })
}
