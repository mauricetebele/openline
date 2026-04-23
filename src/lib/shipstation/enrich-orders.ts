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

/** Flush an array of updates to the DB in batches of 50, then clear it. */
async function flushUpdates(updates: { id: string; data: Record<string, unknown> }[]) {
  if (updates.length === 0) return
  const BATCH_SIZE = 50
  for (let b = 0; b < updates.length; b += BATCH_SIZE) {
    const batch = updates.slice(b, b + BATCH_SIZE)
    await prisma.$transaction(
      batch.map(u => prisma.order.update({ where: { id: u.id }, data: u.data })),
    )
  }
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
  const startTime = Date.now()

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

  // Find MFN orders missing address or ssOrderId (limit to last 90 days to
  // keep volume manageable — older orders are unlikely to need urgent fixes).
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const localOrders = await prisma.order.findMany({
    where: {
      accountId,
      orderSource: { in: ['amazon', 'backmarket'] },
      fulfillmentChannel: { not: 'AFN' },
      purchaseDate: { gte: cutoff },
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

  let enriched = 0
  let addresses = 0

  // Fast path: orders that only need ssOrderId
  if (onlyNeedSsId.length > 0) {
    const ssIdUpdates: { id: string; data: Record<string, unknown> }[] = []
    for (const o of onlyNeedSsId) {
      try {
        const ssOrder = await ssClient.findOrderByNumber(o.amazonOrderId)
        if (ssOrder) ssIdUpdates.push({ id: o.id, data: { ssOrderId: ssOrder.orderId } })
      } catch { /* skip */ }
    }
    await flushUpdates(ssIdUpdates)
    enriched += ssIdUpdates.length
  }

  // Full path: orders needing address — bulk fetch from ShipStation
  if (needAddress.length > 0) {
    const modifyDateStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    const ssOrders = await ssClient.listOrders({ modifyDateStart })
    const ssMap = new Map(ssOrders.map(o => [o.orderNumber, o]))
    log(`[enrich-ss] fetched ${ssOrders.length} SS orders for matching`)

    const bulkUpdates: { id: string; data: Record<string, unknown> }[] = []
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
      bulkUpdates.push({ id: o.id, data })
    }

    // Flush bulk-matched updates IMMEDIATELY — don't wait for individual lookups
    await flushUpdates(bulkUpdates)
    enriched  += bulkUpdates.filter(u => 'ssOrderId' in u.data).length
    addresses += bulkUpdates.filter(u => 'shipToCity' in u.data).length
    log(`[enrich-ss] bulk matched ${bulkUpdates.length}, ${unmatchedOrders.length} unmatched`)

    // Individual lookup for orders not found in bulk list.
    // Cap at 90 seconds elapsed to avoid function timeout.
    const TIMEOUT_MS = 90_000
    const individualUpdates: { id: string; data: Record<string, unknown> }[] = []
    for (const o of unmatchedOrders) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        log(`[enrich-ss] timeout guard — stopping individual lookups (${individualUpdates.length} done, ${unmatchedOrders.length - individualUpdates.length} remaining)`)
        break
      }
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
        individualUpdates.push({ id: o.id, data })
      } catch { /* skip */ }
    }

    await flushUpdates(individualUpdates)
    enriched  += individualUpdates.filter(u => 'ssOrderId' in u.data).length
    addresses += individualUpdates.filter(u => 'shipToCity' in u.data).length
  }

  log(`[enrich-ss] done — enriched=${enriched} addresses=${addresses}`)

  return { enriched, addresses, total: toEnrich.length }
}
