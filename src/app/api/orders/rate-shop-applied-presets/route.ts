/**
 * POST /api/orders/rate-shop-applied-presets
 * Body: { orderIds: string[], accountId: string, shipDate?: string }
 *
 * Rate-shops each order using its applied package preset (appliedPackagePresetId).
 * Each order can have a different preset. Orders without an applied preset are skipped.
 *
 * Streams SSE events matching existing format:
 *   { type: 'rate',  orderId, amazonOrderId, olmNumber, rateAmount, rateCarrier, rateService, rateId, presetName, error }
 *   { type: 'done',  applied, total, skipped, errors }
 *   { type: 'error', error }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient, V2RatesRequest, SSRatesPayload } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  orderIds:  z.array(z.string().min(1)).min(1),
  accountId: z.string().min(1),
  shipDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

const UNIT_SINGULAR: Record<string, string> = {
  ounces: 'ounce', pounds: 'pound', grams: 'gram', kilograms: 'kilogram',
  inches: 'inch', centimeters: 'centimeter',
}
function singularUnit(s: string): string {
  return UNIT_SINGULAR[s] ?? s.replace(/s$/, '')
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }

  const { orderIds, accountId, shipDate } = parsed.data

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds }, accountId },
    include: {
      items: true,
      appliedPackagePreset: true,
    },
  })
  if (orders.length === 0) return NextResponse.json({ error: 'No matching orders found' }, { status: 404 })

  const ssAccount = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true, amazonCarrierId: true },
  })
  if (!ssAccount) return NextResponse.json({ error: 'No ShipStation account connected' }, { status: 404 })

  const v2ApiKey = ssAccount.v2ApiKeyEnc ? decrypt(ssAccount.v2ApiKeyEnc) : null
  const client = new ShipStationClient(
    decrypt(ssAccount.apiKeyEnc),
    ssAccount.apiSecretEnc ? decrypt(ssAccount.apiSecretEnc) : '',
    v2ApiKey,
  )

  let warehouses
  try {
    warehouses = client.hasV1Auth
      ? await client.getWarehouses()
      : await client.getV2Warehouses()
  } catch (err) {
    return NextResponse.json({
      error: `Failed to load ShipStation warehouses: ${err instanceof Error ? err.message : String(err)}`,
    }, { status: 502 })
  }

  const warehouse = warehouses.find(w => w.isDefault) ?? warehouses[0]
  if (!warehouse) return NextResponse.json({ error: 'No warehouses configured in ShipStation' }, { status: 400 })

  const from           = warehouse.originAddress
  const fromPostalCode = from.postalCode.split('-')[0].trim()

  // Fetch all V2 carrier IDs for Amazon Buy Shipping (includes UPS, USPS, etc.)
  let v2CarrierIds: string[] = []
  if (v2ApiKey) {
    try {
      const v2Carriers = await client.getV2Carriers()
      v2CarrierIds = (v2Carriers.carriers ?? []).map(c => String(c.carrier_id))
    } catch {
      if (ssAccount.amazonCarrierId) v2CarrierIds = [ssAccount.amazonCarrierId]
    }
  } else if (ssAccount.amazonCarrierId) {
    v2CarrierIds = [ssAccount.amazonCarrierId]
  }
  console.log('[rate-shop-applied-presets] v2CarrierIds=%o', v2CarrierIds)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let applied = 0
      let skipped = 0
      const errors: { orderId: string; amazonOrderId: string; error: string }[] = []

      try {
        for (let i = 0; i < orders.length; i++) {
          const order = orders[i]
          const preset = order.appliedPackagePreset

          try {
            if (!preset) {
              skipped++
              send({
                type: 'rate', orderId: order.id, amazonOrderId: order.amazonOrderId,
                olmNumber: order.olmNumber, rateAmount: null, rateCarrier: null,
                rateService: null, rateId: null, presetName: null,
                error: 'Skipped: no package preset applied',
              })
              continue
            }

            if (order.orderStatus === 'Shipped') {
              throw new Error('Order is already marked as Shipped on Amazon')
            }

            const wtUnit = singularUnit(preset.weightUnit) as 'ounce' | 'pound' | 'gram' | 'kilogram'
            const dimUnit = singularUnit(preset.dimUnit) as 'inch' | 'centimeter'

            // ── Resolve ship-to address ────────────────────────────────────────
            let toName       = order.shipToName     ?? undefined
            let toAddress1   = order.shipToAddress1 ?? ''
            let toAddress2   = order.shipToAddress2 ?? undefined
            let toCity       = order.shipToCity     ?? ''
            let toState      = order.shipToState    ?? ''
            let toCountry    = order.shipToCountry  ?? 'US'
            let toPhone      = order.shipToPhone    ?? undefined
            let toPostalCode = (order.shipToPostal  ?? '').split('-')[0].trim()

            if (!toPostalCode || !toCity) {
              try {
                const ssOrder = await client.findOrderByNumber(order.amazonOrderId)
                if (ssOrder?.shipTo) {
                  const st = ssOrder.shipTo
                  toPostalCode = st.postalCode.split('-')[0].trim()
                  toCity       = st.city
                  toState      = st.state
                  toCountry    = st.country || 'US'
                  toName       = st.name    || undefined
                  toAddress1   = st.street1
                  toAddress2   = st.street2 ?? undefined
                  toPhone      = st.phone   ?? undefined
                  await prisma.order.update({
                    where: { id: order.id },
                    data: {
                      shipToName:     toName     || null,
                      shipToAddress1: toAddress1 || null,
                      shipToAddress2: toAddress2 || null,
                      shipToCity:     toCity     || null,
                      shipToState:    toState    || null,
                      shipToPostal:   st.postalCode || null,
                      shipToCountry:  toCountry  || null,
                      shipToPhone:    toPhone    || null,
                    },
                  })
                }
              } catch (addrErr) {
                console.warn('[rate-shop-applied] order=%s address lookup failed: %s',
                  order.amazonOrderId, addrErr instanceof Error ? addrErr.message : String(addrErr))
              }
            }

            // ── Fetch shipping rates ─────────────────────────────────────────
            let rateAmount:  number
            let rateCarrier: string
            let rateService: string
            let rateId:      string | undefined

            const orderIsAmazon = order.orderSource !== 'backmarket'

            if (orderIsAmazon) {
              if (v2CarrierIds.length === 0) {
                throw new Error('No Amazon Buy Shipping carriers found — check ShipStation Settings')
              }

              const v2Payload: V2RatesRequest = {
                rate_options: { carrier_ids: v2CarrierIds },
                shipment: {
                  ...(shipDate ? { ship_date: `${shipDate}` } : {}),
                  ship_from: {
                    name:           from.name,
                    phone:          from.phone || '555-555-5555',
                    address_line1:  from.street1,
                    city_locality:  from.city,
                    state_province: from.state,
                    postal_code:    fromPostalCode,
                    country_code:   from.country || 'US',
                  },
                  ship_to: {
                    name:                          toName,
                    phone:                         toPhone || '555-555-5555',
                    address_line1:                 toAddress1,
                    address_line2:                 toAddress2,
                    city_locality:                 toCity,
                    state_province:                toState,
                    postal_code:                   toPostalCode,
                    country_code:                  toCountry,
                    address_residential_indicator: 'unknown',
                  },
                  packages: [{
                    weight: { unit: wtUnit, value: preset.weightValue },
                    ...(preset.dimLength && preset.dimWidth && preset.dimHeight
                      ? { dimensions: { unit: dimUnit, length: preset.dimLength, width: preset.dimWidth, height: preset.dimHeight } }
                      : {}),
                  }],
                  order_source_code: 'amazon',
                  items: order.items.map(item => ({
                    name:                   item.title ?? undefined,
                    quantity:               item.quantityOrdered,
                    external_order_id:      order.amazonOrderId,
                    external_order_item_id: item.orderItemId,
                  })),
                },
              }

              const v2Result = await client.getRatesV2(v2Payload)
              const allRates = v2Result.rate_response?.rates ?? []
              const validRates = allRates
                .filter(r => r.validation_status !== 'invalid')
                .filter(r => !r.package_type || r.package_type === 'package') // exclude flat rate envelopes/boxes
                .sort((a, b) =>
                  (a.shipping_amount.amount + a.other_amount.amount) -
                  (b.shipping_amount.amount + b.other_amount.amount)
                )

              const cheapest = validRates[0]
              if (!cheapest) {
                const statuses = allRates.map(r => `${r.service_code}:${r.validation_status}`).join(', ')
                throw new Error(`No valid rates returned (${allRates.length} total: ${statuses || 'none'})`)
              }

              rateAmount  = cheapest.shipping_amount.amount + cheapest.other_amount.amount
              rateCarrier = cheapest.carrier_friendly_name || cheapest.carrier_code
              rateService = cheapest.service_type || cheapest.service_code
              rateId      = cheapest.rate_id

            } else {
              // ── Non-Amazon orders → V1 rates across all carriers ─────────────
              let v1Carriers
              try { v1Carriers = await client.getCarriers() } catch {
                throw new Error('Failed to load ShipStation carriers')
              }
              const nonAmazonCarriers = v1Carriers.filter(c => !c.code.toLowerCase().includes('amazon'))
              if (nonAmazonCarriers.length === 0) {
                throw new Error('No non-Amazon carriers connected to ShipStation (add UPS/FedEx/USPS)')
              }

              const allV1Rates: { serviceName: string; serviceCode: string; carrierCode: string; shipmentCost: number; otherCost: number; rate_id?: string }[] = []
              for (const c of nonAmazonCarriers) {
                try {
                  const rates = await client.getRates({
                    carrierCode:    c.code,
                    fromPostalCode,
                    fromCity:       from.city,
                    fromState:      from.state,
                    toPostalCode,
                    toCity,
                    toState,
                    toCountry,
                    weight: { value: preset.weightValue, units: preset.weightUnit as 'ounces' | 'pounds' | 'grams' | 'kilograms' },
                    ...(preset.dimLength && preset.dimWidth && preset.dimHeight
                      ? { dimensions: { units: preset.dimUnit as 'inches' | 'centimeters', length: preset.dimLength, width: preset.dimWidth, height: preset.dimHeight } }
                      : {}),
                  } as SSRatesPayload)
                  const hasDims = !!(preset.dimLength && preset.dimWidth && preset.dimHeight)
                  for (const r of rates) {
                    if (hasDims && /flat rate|envelope/i.test(r.serviceName)) continue
                    allV1Rates.push(r)
                  }
                } catch (e) {
                  console.warn('[rate-shop-applied] V1 carrier %s error: %s', c.code, e instanceof Error ? e.message : String(e))
                }
              }

              if (allV1Rates.length === 0) {
                throw new Error('No valid rates returned from any carrier (UPS/FedEx/USPS)')
              }

              const cheapest = allV1Rates.sort((a, b) => (a.shipmentCost + a.otherCost) - (b.shipmentCost + b.otherCost))[0]
              rateAmount  = cheapest.shipmentCost + cheapest.otherCost
              rateCarrier = cheapest.carrierCode
              rateService = cheapest.serviceName
              rateId      = cheapest.rate_id
            }

            // ── Persist rate on order ─────────────────────────────────────────
            await prisma.order.update({
              where: { id: order.id },
              data: {
                presetRateAmount:    rateAmount,
                presetRateCarrier:   rateCarrier,
                presetRateService:   rateService,
                presetRateId:        rateId,
                presetRateError:     null,
                presetRateCheckedAt: new Date(),
                presetShipDate:      shipDate ?? null,
              },
            })

            applied++
            send({
              type:          'rate',
              orderId:       order.id,
              amazonOrderId: order.amazonOrderId,
              olmNumber:     order.olmNumber,
              rateAmount,
              rateCarrier,
              rateService,
              rateId,
              presetName:    preset.name,
              error:         null,
            })

          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            errors.push({ orderId: order.id, amazonOrderId: order.amazonOrderId, error: msg })
            try {
              await prisma.order.update({
                where: { id: order.id },
                data:  { presetRateError: msg, presetRateCheckedAt: new Date() },
              })
            } catch { /* best-effort */ }
            send({ type: 'rate', orderId: order.id, amazonOrderId: order.amazonOrderId, olmNumber: order.olmNumber, rateAmount: null, rateCarrier: null, rateService: null, rateId: null, presetName: null, error: msg })
          }

          if (i < orders.length - 1) await sleep(400)
        }

        send({ type: 'done', applied, total: orders.length, skipped, errors })
      } catch (fatalErr) {
        send({ type: 'error', error: fatalErr instanceof Error ? fatalErr.message : String(fatalErr) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
