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
 * Streams progress events as newline-delimited JSON so the UI can show
 * real-time status.
 *
 * Events:
 *   { phase: "fetching" }
 *   { phase: "fetched", total: N }
 *   { phase: "checking", checked: N }
 *   { phase: "updating", done: N, of: N }
 *   { phase: "done", enriched: N, addresses: N, total: N, checked: N }
 *   { phase: "error", error: "..." }
 */
import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  function send(data: Record<string, unknown>) {
    writer.write(encoder.encode(JSON.stringify(data) + '\n'))
  }

  ;(async () => {
    try {
      const user = await getAuthUser()
      if (!user) { send({ phase: 'error', error: 'Unauthorized' }); writer.close(); return }

      const { accountId, orderIds } = await req.json()
      if (!accountId) { send({ phase: 'error', error: 'Missing accountId' }); writer.close(); return }
      const scopedIds: string[] | undefined = Array.isArray(orderIds) && orderIds.length > 0 ? orderIds : undefined

      // Load active ShipStation credentials
      const ssAccount = await prisma.shipStationAccount.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { apiKeyEnc: true, apiSecretEnc: true },
      })
      if (!ssAccount) {
        send({ phase: 'done', enriched: 0, addresses: 0, total: 0, checked: 0 })
        writer.close()
        return
      }

      const ssClient = new ShipStationClient(
        decrypt(ssAccount.apiKeyEnc),
        ssAccount.apiSecretEnc ? decrypt(ssAccount.apiSecretEnc) : '',
      )

      // Phase 1: Fetch SS orders
      send({ phase: 'fetching' })
      const modifyDateStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
      const ssOrders = await ssClient.listOrders({ modifyDateStart })
      const ssMap = new Map(ssOrders.map(o => [o.orderNumber, o]))
      send({ phase: 'fetched', total: ssOrders.length })

      // Phase 2: Find local orders needing enrichment
      const needsEnrichment = await prisma.order.findMany({
        where: {
          accountId,
          orderSource: { in: ['amazon', 'backmarket'] },
          ...(scopedIds ? { id: { in: scopedIds } } : {}),
          OR: [
            { shipToPostal: null },
            { shipToCity: null },
            { ssOrderId: null },
          ],
        },
        select: { id: true, amazonOrderId: true, shipToPostal: true, shipToCity: true, ssOrderId: true },
      })
      const total = scopedIds ? scopedIds.length : needsEnrichment.length
      send({ phase: 'checking', checked: needsEnrichment.length, total })

      // Build batch updates
      const updates: { id: string; data: Record<string, unknown> }[] = []
      const unmatchedOrders: typeof needsEnrichment = []
      for (const o of needsEnrichment) {
        const ssOrder = ssMap.get(o.amazonOrderId)
        if (!ssOrder) { unmatchedOrders.push(o); continue }

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

      // Phase 2b: Individual lookup for orders not found in the bulk list
      if (unmatchedOrders.length > 0) {
        send({ phase: 'individual-lookup', remaining: unmatchedOrders.length })
        for (const o of unmatchedOrders) {
          try {
            const ssOrder = await ssClient.findOrderByNumber(o.amazonOrderId)
            if (!ssOrder) continue

            const needsAddr = !o.shipToPostal || !o.shipToCity
            const data: Record<string, unknown> = { ssOrderId: ssOrder.orderId }
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
          } catch { /* skip on error, don't block the rest */ }
        }
      }

      // Phase 3: Execute in batches of 50 with progress
      if (updates.length > 0) {
        const BATCH_SIZE = 50
        let done = 0
        for (let b = 0; b < updates.length; b += BATCH_SIZE) {
          const batch = updates.slice(b, b + BATCH_SIZE)
          await prisma.$transaction(
            batch.map(u => prisma.order.update({ where: { id: u.id }, data: u.data })),
          )
          done += batch.length
          send({ phase: 'updating', done, of: updates.length })
        }
      }

      const addrCount = updates.filter(u => 'shipToCity' in u.data).length
      const ssIdCount = updates.filter(u => 'ssOrderId' in u.data).length

      send({
        phase: 'done',
        enriched: ssIdCount,
        addresses: addrCount,
        total: ssOrders.length,
        checked: needsEnrichment.length,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[enrich-shipstation]', message)
      send({ phase: 'error', error: message })
    } finally {
      writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  })
}
