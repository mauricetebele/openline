/**
 * Background address-enrichment job — runs every 10 minutes.
 *
 * Amazon masks shipping addresses on unshipped MFN orders (city, state, postal
 * come back null from the SP-API).  ShipStation has the real address once it
 * has imported the order.  This job finds any orders still missing address
 * fields and fills them in from ShipStation automatically, so the user never
 * needs to click "Sync from ShipStation" on individual orders.
 *
 * Called once at server startup via src/instrumentation.ts.
 */
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

const INTERVAL_MS  = 10 * 60 * 1000  // 10 minutes
const SS_GAP_MS    = 700              // ~85 req/min max; this keeps us under 40 req/min

// Prevent duplicate timers across Next.js hot-reloads in development.
const g = globalThis as typeof globalThis & {
  _addressEnrichmentTimer?: ReturnType<typeof setInterval>
  _addressEnrichmentRunning?: boolean
}

export function scheduleAddressEnrichment(): void {
  if (g._addressEnrichmentTimer) return

  console.log('[AddressEnrichment] Scheduler started — enriching missing addresses every 10 minutes')
  // Run once at startup (give the server a few seconds to finish booting first),
  // then on the regular interval.
  setTimeout(runEnrichment, 15_000)
  g._addressEnrichmentTimer = setInterval(runEnrichment, INTERVAL_MS)
}

async function runEnrichment(): Promise<void> {
  if (g._addressEnrichmentRunning) {
    console.log('[AddressEnrichment] Previous run still in progress — skipping')
    return
  }
  g._addressEnrichmentRunning = true

  try {
    const ssAccount = await prisma.shipStationAccount.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { apiKeyEnc: true, apiSecretEnc: true },
    })
    if (!ssAccount) return  // no ShipStation account configured yet

    const orders = await prisma.order.findMany({
      where: { OR: [{ shipToPostal: null }, { shipToCity: null }] },
      select: { id: true, amazonOrderId: true },
    })
    if (orders.length === 0) return

    console.log(`[AddressEnrichment] ${orders.length} order(s) missing address — querying ShipStation`)

    const ssClient = new ShipStationClient(
      decrypt(ssAccount.apiKeyEnc),
      decrypt(ssAccount.apiSecretEnc),
    )

    let enriched = 0
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i]
      try {
        const ssOrder = await ssClient.findOrderByNumber(order.amazonOrderId)
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
            },
          })
          enriched++
          console.log(`[AddressEnrichment] ${order.amazonOrderId} → ${st.city}, ${st.state} ${st.postalCode}`)
        }
      } catch (e) {
        console.warn(`[AddressEnrichment] Lookup failed for ${order.amazonOrderId}:`, e instanceof Error ? e.message : String(e))
      }
      if (i < orders.length - 1) await sleep(SS_GAP_MS)
    }

    if (enriched > 0) console.log(`[AddressEnrichment] Pass complete — ${enriched}/${orders.length} orders enriched`)
  } catch (e) {
    console.error('[AddressEnrichment] Error:', e instanceof Error ? e.message : String(e))
  } finally {
    g._addressEnrichmentRunning = false
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
