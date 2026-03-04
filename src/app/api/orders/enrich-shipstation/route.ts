/**
 * POST /api/orders/enrich-shipstation
 * Body: { accountId: string }
 *
 * Bulk-fetches recent ShipStation orders and matches them to local orders
 * (Amazon + BackMarket) by orderNumber → amazonOrderId. Updates:
 *  1) ssOrderId — drives the yellow-row "not synced" tint
 *  2) Shipping address — Amazon masks addresses on unshipped MFN orders;
 *     ShipStation has the real address
 *
 * Designed to run AFTER order sync completes. Fast: one paginated
 * SS API call + batch DB updates.
 *
 * Returns { enriched, addresses, total } so the UI can show progress.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { accountId } = await req.json()
    if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

    // Load active ShipStation credentials
    const ssAccount = await prisma.shipStationAccount.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { apiKeyEnc: true, apiSecretEnc: true },
    })
    if (!ssAccount) {
      return NextResponse.json({ error: 'No active ShipStation account', enriched: 0, addresses: 0, total: 0 })
    }

    const ssClient = new ShipStationClient(
      decrypt(ssAccount.apiKeyEnc),
      ssAccount.apiSecretEnc ? decrypt(ssAccount.apiSecretEnc) : '',
    )

    // Bulk fetch recent SS orders (paginated at 500/page)
    const modifyDateStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    const ssOrders = await ssClient.listOrders({ modifyDateStart })
    const ssMap = new Map(ssOrders.map(o => [o.orderNumber, o]))

    // Find local orders (Amazon + BackMarket) that need enrichment
    const needsEnrichment = await prisma.order.findMany({
      where: {
        accountId,
        orderSource: { in: ['amazon', 'backmarket'] },
        OR: [
          { shipToPostal: null },
          { shipToCity: null },
          { ssOrderId: null },
        ],
      },
      select: { id: true, amazonOrderId: true, shipToPostal: true, shipToCity: true, ssOrderId: true },
    })

    // Build batch updates
    const updates: { id: string; data: Record<string, unknown> }[] = []
    for (const o of needsEnrichment) {
      const ssOrder = ssMap.get(o.amazonOrderId)
      if (!ssOrder) continue

      const needsAddr = !o.shipToPostal || !o.shipToCity
      const needsSsId = !o.ssOrderId
      if (!needsAddr && !needsSsId) continue

      const data: Record<string, unknown> = {}
      if (needsSsId) data.ssOrderId = ssOrder.orderId
      if (needsAddr && ssOrder.shipTo) {
        const st = ssOrder.shipTo
        data.shipToName     = st.name       || null
        data.shipToAddress1 = st.street1    || null
        data.shipToAddress2 = st.street2    || null
        data.shipToCity     = st.city       || null
        data.shipToState    = st.state      || null
        data.shipToPostal   = st.postalCode || null
        data.shipToCountry  = st.country    || null
        data.shipToPhone    = st.phone      || null
      }
      updates.push({ id: o.id, data })
    }

    // Execute in batches of 50
    if (updates.length > 0) {
      const BATCH_SIZE = 50
      for (let b = 0; b < updates.length; b += BATCH_SIZE) {
        const batch = updates.slice(b, b + BATCH_SIZE)
        await prisma.$transaction(
          batch.map(u => prisma.order.update({ where: { id: u.id }, data: u.data })),
        )
      }
    }

    const addrCount = updates.filter(u => 'shipToCity' in u.data).length
    const ssIdCount = updates.filter(u => 'ssOrderId' in u.data).length

    return NextResponse.json({
      enriched: ssIdCount,
      addresses: addrCount,
      total: ssOrders.length,
      checked: needsEnrichment.length,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[enrich-shipstation]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
