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
import { loadFedExCredentials, getRates as getFedExRates, type FedExRateParams } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  orderIds:  z.array(z.string().min(1)).min(1),
  accountId: z.string().min(1),
  shipDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fedexDirectOnly: z.boolean().optional(),
})

const CONCURRENCY = 4

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

  const { orderIds, accountId, shipDate, fedexDirectOnly } = parsed.data

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
  const ssWarehouseId  = `se-${warehouse.warehouseId}`

  const amazonV2CarrierId = ssAccount.amazonCarrierId ?? null
  console.log('[rate-shop-applied-presets] amazonV2CarrierId=%s fedexDirectOnly=%s', amazonV2CarrierId, fedexDirectOnly)

  // Pre-load FedEx credentials when FedEx Direct mode is requested
  const fedexCreds = fedexDirectOnly ? await loadFedExCredentials() : null
  if (fedexDirectOnly && !fedexCreds) {
    return NextResponse.json({ error: 'FedEx credentials not configured — go to Settings → FedEx' }, { status: 400 })
  }

  const FEDEX_PACKAGING_TYPES = new Set([
    'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_SMALL_BOX', 'FEDEX_MEDIUM_BOX',
    'FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX', 'FEDEX_TUBE',
  ])

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let applied = 0
      let skipped = 0
      const errors: { orderId: string; amazonOrderId: string; error: string }[] = []

      // Pre-cache V1 carriers once (shared across all non-Amazon orders)
      let v1CarriersCache: Awaited<ReturnType<typeof client.getCarriers>> | null = null

      // Simple concurrency limiter — runs up to CONCURRENCY tasks at once
      let running = 0
      const waitQueue: (() => void)[] = []
      async function acquireSlot() {
        if (running >= CONCURRENCY) {
          await new Promise<void>(r => waitQueue.push(r))
        }
        running++
      }
      function releaseSlot() {
        running--
        const next = waitQueue.shift()
        if (next) next()
      }

      try {
        // Process a single order — called concurrently
        const processOrder = async (order: typeof orders[number]) => {
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
              return
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

            if (fedexDirectOnly && fedexCreds) {
              // ── FedEx Direct path — bypass ShipStation entirely ──────────────
              const fedexWeightUnits: 'LB' | 'KG' =
                preset.weightUnit === 'grams' || preset.weightUnit === 'kilograms' ? 'KG' : 'LB'
              let fedexWeightValue = preset.weightValue
              if (preset.weightUnit === 'ounces') fedexWeightValue = preset.weightValue / 16
              else if (preset.weightUnit === 'grams') fedexWeightValue = preset.weightValue / 1000

              const fedexDimUnits: 'IN' | 'CM' =
                preset.dimUnit === 'centimeters' ? 'CM' : 'IN'

              const isFedExPackaging = preset.packageCode ? FEDEX_PACKAGING_TYPES.has(preset.packageCode) : false

              const fedexParams: FedExRateParams = {
                shipFrom: {
                  streetLines: [from.street1, from.street2].filter(Boolean) as string[],
                  city: from.city,
                  stateOrProvinceCode: from.state,
                  postalCode: fromPostalCode,
                  countryCode: from.country || 'US',
                },
                shipTo: {
                  streetLines: [toAddress1, toAddress2].filter(Boolean) as string[],
                  city: toCity,
                  stateOrProvinceCode: toState,
                  postalCode: toPostalCode,
                  countryCode: toCountry,
                },
                weight: { value: Math.max(fedexWeightValue, 0.1), units: fedexWeightUnits },
                ...(preset.dimLength && preset.dimWidth && preset.dimHeight
                  ? { dimensions: { length: preset.dimLength, width: preset.dimWidth, height: preset.dimHeight, units: fedexDimUnits } }
                  : {}),
                ...(shipDate ? { shipDate } : {}),
                ...(isFedExPackaging ? { packagingType: preset.packageCode!, oneRate: true } : {}),
              }

              const fedexRates = await getFedExRates(fedexCreds, fedexParams)
              if (fedexRates.length === 0) {
                throw new Error('No FedEx Direct rates returned')
              }

              const cheapest = fedexRates.sort((a, b) =>
                (a.shipmentCost + a.otherCost) - (b.shipmentCost + b.otherCost)
              )[0]

              rateAmount  = cheapest.shipmentCost + cheapest.otherCost
              rateCarrier = cheapest.carrierCode || 'fedex_direct'
              rateService = cheapest.serviceName
              rateId      = cheapest.rate_id

            } else if (orderIsAmazon) {
              if (!amazonV2CarrierId) {
                throw new Error('Amazon carrier ID not configured — go to ShipStation Settings')
              }

              const v2Payload: V2RatesRequest = {
                rate_options: { carrier_ids: [amazonV2CarrierId] },
                shipment: {
                  ...(shipDate ? { ship_date: `${shipDate}` } : {}),
                  warehouse_id: ssWarehouseId,
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
                  ...('insuranceProvider' in preset && preset.insuranceProvider ? { insurance_provider: preset.insuranceProvider as 'parcelguard' | 'carrier' } : {}),
                  packages: [{
                    weight: { unit: wtUnit, value: preset.weightValue },
                    ...(preset.dimLength && preset.dimWidth && preset.dimHeight
                      ? { dimensions: { unit: dimUnit, length: preset.dimLength, width: preset.dimWidth, height: preset.dimHeight } }
                      : {}),
                    ...('insuredValue' in preset && preset.insuredValue ? { insured_value: { amount: preset.insuredValue as number, currency: 'usd' } } : {}),
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
              // Filter out One Rate services when package dimensions exceed One Rate limits
              // FedEx One Rate max: ~16x15x12 (Extra Large Box). If any dim > 16", One Rate won't fit.
              const maxDim = Math.max(preset.dimLength ?? 0, preset.dimWidth ?? 0, preset.dimHeight ?? 0)
              const validRates = allRates
                .filter(r => r.validation_status !== 'invalid')
                .filter(r => !(maxDim > 16 && /one rate/i.test(r.service_type || r.service_code)))
                .sort((a, b) =>
                  (a.shipping_amount.amount + (a.insurance_amount?.amount ?? 0) + a.other_amount.amount) -
                  (b.shipping_amount.amount + (b.insurance_amount?.amount ?? 0) + b.other_amount.amount)
                )

              const cheapest = validRates[0]
              if (!cheapest) {
                const statuses = allRates.map(r => `${r.service_code}:${r.validation_status}`).join(', ')
                throw new Error(`No valid rates returned (${allRates.length} total: ${statuses || 'none'})`)
              }

              rateAmount  = cheapest.shipping_amount.amount + (cheapest.insurance_amount?.amount ?? 0) + cheapest.other_amount.amount
              rateCarrier = cheapest.carrier_friendly_name || cheapest.carrier_code
              rateService = cheapest.service_type || cheapest.service_code
              rateId      = cheapest.rate_id

            } else {
              // ── Non-Amazon orders (BackMarket) → try UPS first, then all carriers ──
              if (!v1CarriersCache) {
                try { v1CarriersCache = await client.getCarriers() } catch {
                  throw new Error('Failed to load ShipStation carriers')
                }
              }
              const nonAmazonCarriers = v1CarriersCache.filter(c => !c.code.toLowerCase().includes('amazon'))
              if (nonAmazonCarriers.length === 0) {
                throw new Error('No non-Amazon carriers connected to ShipStation (add UPS/FedEx/USPS)')
              }

              type V1Rate = { serviceName: string; serviceCode: string; carrierCode: string; shipmentCost: number; otherCost: number; rate_id?: string }
              const ratePayloadBase = {
                packageCode:    preset.packageCode ?? undefined,
                fromPostalCode,
                fromCity:       from.city,
                fromState:      from.state,
                toPostalCode,
                toCity,
                toState,
                toCountry,
                weight: { value: preset.weightValue, units: preset.weightUnit as 'ounces' | 'pounds' | 'grams' | 'kilograms' } as const,
                ...(preset.dimLength && preset.dimWidth && preset.dimHeight
                  ? { dimensions: { units: preset.dimUnit as 'inches' | 'centimeters', length: preset.dimLength, width: preset.dimWidth, height: preset.dimHeight } }
                  : {}),
              }
              const hasDims = !!(preset.dimLength && preset.dimWidth && preset.dimHeight)
              const isFlatRatePkg = preset.packageCode && /flat_rate|envelope|regional_rate/i.test(preset.packageCode)

              // Step 1: Try UPS carrier, filtering out USPS-via-UPS services (SurePost, Mail Innovations)
              const upsCarrier = nonAmazonCarriers.find(c => c.code === 'ups_walleted' || c.code === 'ups')
              let upsRates: V1Rate[] = []
              if (upsCarrier) {
                try {
                  const raw = await client.getRates({ carrierCode: upsCarrier.code, ...ratePayloadBase } as SSRatesPayload)
                  for (const r of raw) {
                    if (hasDims && !isFlatRatePkg && /flat rate|envelope/i.test(r.serviceName)) continue
                    if (/usps|surepost|mail innovations/i.test(r.serviceName)) continue
                    upsRates.push({ ...r, carrierCode: r.carrierCode || upsCarrier.code })
                  }
                } catch (e) {
                  console.warn('[rate-shop-applied] UPS carrier %s error: %s', upsCarrier.code, e instanceof Error ? e.message : String(e))
                }
              }

              let chosen: V1Rate | undefined
              if (upsRates.length > 0) {
                const ground = upsRates.find(r => /ground/i.test(r.serviceName))
                chosen = ground ?? upsRates.sort((a, b) => (a.shipmentCost + a.otherCost) - (b.shipmentCost + b.otherCost))[0]
                console.log('[rate-shop-applied] order=%s BM UPS rate=%s %s $%s', order.amazonOrderId, chosen.carrierCode, chosen.serviceName, (chosen.shipmentCost + chosen.otherCost).toFixed(2))
              } else {
                // Step 2: No UPS rate — fall back to ALL non-Amazon carriers
                const allV1Rates: V1Rate[] = []
                for (const c of nonAmazonCarriers) {
                  try {
                    const rates = await client.getRates({ carrierCode: c.code, ...ratePayloadBase } as SSRatesPayload)
                    for (const r of rates) {
                      if (hasDims && !isFlatRatePkg && /flat rate|envelope/i.test(r.serviceName)) continue
                      allV1Rates.push({ ...r, carrierCode: r.carrierCode || c.code })
                    }
                  } catch (e) {
                    console.warn('[rate-shop-applied] V1 carrier %s error: %s', c.code, e instanceof Error ? e.message : String(e))
                  }
                }
                if (allV1Rates.length === 0) {
                  throw new Error('No valid rates returned from any carrier (UPS/FedEx/USPS)')
                }
                chosen = allV1Rates.sort((a, b) => (a.shipmentCost + a.otherCost) - (b.shipmentCost + b.otherCost))[0]
                console.log('[rate-shop-applied] order=%s BM fallback cheapest=%s %s $%s', order.amazonOrderId, chosen.carrierCode, chosen.serviceName, (chosen.shipmentCost + chosen.otherCost).toFixed(2))
              }

              rateAmount  = chosen.shipmentCost + chosen.otherCost
              rateCarrier = chosen.carrierCode
              rateService = chosen.serviceName
              rateId      = chosen.rate_id
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
        }

        // Launch all orders with concurrency limit
        await Promise.all(orders.map(async (order) => {
          await acquireSlot()
          try {
            await processOrder(order)
          } finally {
            releaseSlot()
          }
        }))

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
