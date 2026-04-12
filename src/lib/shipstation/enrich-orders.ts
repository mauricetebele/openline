/**
 * Core ShipStation enrichment logic — reusable by both the cron and the
 * streaming UI endpoint.
 *
 * Finds local MFN orders missing address / ssOrderId, bulk-fetches recent
 * ShipStation orders, matches by orderNumber → amazonOrderId, and updates
 * the local DB.
 */
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export interface EnrichResult {
  enriched: number   // orders that got ssOrderId set
  addresses: number  // orders that got address fields set
  total: number      // total orders checked
}

/**
 * Enrich orders for a single account. Safe to call even when no SS
 * credentials exist (returns zeros).
 */
export async function enrichOrdersFromShipStation(
  accountId: string,
  onProgress?: (msg: string) => void,
): Promise<EnrichResult> {
  const log = onProgress ?? (() => {})

  // Load active ShipStation credentials
  const ssAccount = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { apiKeyEnc: true, apiSecretEnc: true },
  })
  if (!ssAccount) return { enriched: 0, addresses: 0, total: 0 }

  const ssClient = new ShipStationClient(
    decrypt(ssAccount.apiKeyEnc),
    ssAccount.apiSecretEnc ? decrypt(ssAccount.apiSecretEnc) : '',
  )

  // Find MFN orders missing address or ssOrderId
  const localOrders = await prisma.order.findMany({
    where: {
      accountId,
      orderSource: { in: ['amazon', 'backmarket'] },
      fulfillmentChannel: { not: 'AFN' },
      OR: [
        { shipToPostal: null },
        { shipToCity: null },
        { ssOrderId: null },
      ],
    },
    select: { id: true, amazonOrderId: true, shipToPostal: true, shipToCity: true, ssOrderId: true },
  })

  // Filter to only those actually needing enrichment
  const toEnrich = localOrders.filter(o => !o.shipToPostal || !o.shipToCity || !o.ssOrderId)
  if (toEnrich.length === 0) return { enriched: 0, addresses: 0, total: 0 }

  log(`[enrich-ss] ${toEnrich.length} orders need enrichment`)

  const onlyNeedSsId = toEnrich.filter(o => o.shipToPostal && o.shipToCity && !o.ssOrderId)
  const needAddress  = toEnrich.filter(o => !o.shipToPostal || !o.shipToCity)

  const updates: { id: string; data: Record<string, unknown> }[] = []

  // Fast path: orders that only need ssOrderId
  for (const o of onlyNeedSsId) {
    try {
      const ssOrder = await ssClient.findOrderByNumber(o.amazonOrderId)
      if (ssOrder) updates.push({ id: o.id, data: { ssOrderId: ssOrder.orderId } })
    } catch { /* skip */ }
  }

  // Full path: orders needing address — bulk fetch from ShipStation
  if (needAddress.length > 0) {
    const modifyDateStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    const ssOrders = await ssClient.listOrders({ modifyDateStart })
    const ssMap = new Map(ssOrders.map(o => [o.orderNumber, o]))
    log(`[enrich-ss] fetched ${ssOrders.length} SS orders for matching`)

    const unmatchedOrders: typeof toEnrich = []

    for (const o of needAddress) {
      const ssOrder = ssMap.get(o.amazonOrderId)
      if (!ssOrder) { unmatchedOrders.push(o); continue }

      const data: Record<string, unknown> = {}
      if (!o.ssOrderId) data.ssOrderId = ssOrder.orderId
      if (ssOrder.shipTo) {
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

    // Individual lookup for orders not found in bulk list
    for (const o of unmatchedOrders) {
      try {
        const ssOrder = await ssClient.findOrderByNumber(o.amazonOrderId)
        if (!ssOrder) continue

        const data: Record<string, unknown> = { ssOrderId: ssOrder.orderId }
        if (ssOrder.shipTo) {
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
      } catch { /* skip */ }
    }
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

  const addresses = updates.filter(u => 'shipToCity' in u.data).length
  const enriched  = updates.filter(u => 'ssOrderId' in u.data).length

  log(`[enrich-ss] done — enriched=${enriched} addresses=${addresses}`)

  return { enriched, addresses, total: toEnrich.length }
}
