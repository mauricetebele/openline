/**
 * POST /api/orders/apply-preset
 * Body: { presetId: string, orderIds: string[], accountId: string }
 *
 * Streams SSE events as each order is rated, so the client can display rates
 * in real time rather than waiting for the full batch to complete.
 *
 * Event shapes:
 *   { type: 'rate',  orderId, amazonOrderId, olmNumber, rateAmount, rateCarrier, rateService, rateId, error }
 *   { type: 'done',  applied, total, errors: [...] }
 *   { type: 'error', error }   — fatal setup error (before any orders are rated)
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { decrypt } from '@/lib/crypto'
import {
  ShipStationClient,
  SSRatesPayload,
  V2RatesRequest,
} from '@/lib/shipstation/client'
import { loadFedExCredentials, getRates as getFedExRates, type FedExRateParams } from '@/lib/fedex/client'
import { getUpsDirectRates } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  presetId:  z.string().min(1),
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
  // ── Auth & validation — return normal JSON errors before starting the stream ──
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

  const { presetId, orderIds, accountId, shipDate } = parsed.data

  const preset = await prisma.shippingPreset.findUnique({ where: { id: presetId } })
  if (!preset) return NextResponse.json({ error: 'Preset not found' }, { status: 404 })

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds }, accountId },
    include: { items: true },
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

  const from            = warehouse.originAddress
  const fromPostalCode  = from.postalCode.split('-')[0].trim()
  const ssWarehouseId   = `se-${warehouse.warehouseId}`
  const isAmazonCarrier  = preset.carrierCode.toLowerCase().includes('amazon')
  const isFedExDirect    = preset.carrierCode === 'fedex_direct'
  const isUpsDirect      = preset.carrierCode === 'ups_direct' && !!preset.upsCredentialId

  // Pre-load FedEx credentials when using FedEx Direct
  const fedexCreds = isFedExDirect ? await loadFedExCredentials() : null
  if (isFedExDirect && !fedexCreds) {
    return NextResponse.json({ error: 'FedEx credentials not configured — go to Settings → FedEx' }, { status: 400 })
  }

  const FEDEX_PACKAGING_TYPES = new Set([
    'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_SMALL_BOX', 'FEDEX_MEDIUM_BOX',
    'FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX', 'FEDEX_TUBE',
  ])

  console.log('[apply-preset] warehouse=%s fromPostal=%s carrier=%s service=%s orders=%d isAmazon=%s fedexDirect=%s upsDirect=%s',
    warehouse.warehouseName, fromPostalCode, preset.carrierCode, preset.serviceCode ?? '(cheapest)', orders.length, isAmazonCarrier, isFedExDirect, isUpsDirect)

  const amazonV2CarrierId = ssAccount.amazonCarrierId ?? null
  console.log('[apply-preset] amazonV2CarrierId=%s', amazonV2CarrierId)

  // ── All setup done — switch to streaming ────────────────────────────────────
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let applied = 0
      const errors: { orderId: string; amazonOrderId: string; error: string }[] = []

      try {
        for (let i = 0; i < orders.length; i++) {
          const order = orders[i]

          try {
            // Reject orders already marked as shipped
            if (order.orderStatus === 'Shipped') {
              throw new Error('Order is already marked as Shipped')
            }

            // Amazon Buy Shipping presets can't be used for non-Amazon orders
            const orderIsAmazon = order.orderSource !== 'backmarket'
            const useAmazonV2   = isAmazonCarrier && orderIsAmazon

            let rateAmount: number | null  = null
            let rateCarrier: string | null = null
            let rateService: string | null = null
            let rateId: string | null      = null

            // ── Resolve ship-to address ──────────────────────────────────────
            // Amazon masks addresses on unshipped orders, so our DB fields may
            // be null until the user manually syncs from ShipStation.  If the
            // address is missing we do an on-the-fly ShipStation lookup (same
            // as sync-buyer-info) and persist the result so future calls work
            // without an extra round-trip.
            let toName     = order.shipToName     ?? undefined
            let toAddress1 = order.shipToAddress1 ?? ''
            let toAddress2 = order.shipToAddress2 ?? undefined
            let toCity     = order.shipToCity     ?? ''
            let toState    = order.shipToState    ?? ''
            let toCountry  = order.shipToCountry  ?? 'US'
            let toPhone    = order.shipToPhone    ?? undefined
            let toPostalCode = (order.shipToPostal ?? '').split('-')[0].trim()

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
                  // Persist so subsequent operations (and the grid) have the real address
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
                  console.log('[apply-preset] order=%s address resolved from ShipStation postal=%s', order.amazonOrderId, toPostalCode)
                }
              } catch (addrErr) {
                console.warn('[apply-preset] order=%s address lookup failed: %s', order.amazonOrderId, addrErr instanceof Error ? addrErr.message : String(addrErr))
              }
            }

            if (isFedExDirect && fedexCreds) {
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

              // If a specific service was chosen, find that rate; otherwise pick cheapest
              const sorted = fedexRates.sort((a, b) =>
                (a.shipmentCost + a.otherCost) - (b.shipmentCost + b.otherCost)
              )
              const match = preset.serviceCode
                ? sorted.find(r => r.serviceCode === preset.serviceCode) ?? sorted[0]
                : sorted[0]

              rateAmount  = match.shipmentCost + match.otherCost
              rateCarrier = match.carrierCode || 'fedex_direct'
              rateService = match.serviceName
              rateId      = match.rate_id ?? null

            } else if (useAmazonV2) {
              if (!amazonV2CarrierId) {
                throw new Error('Amazon carrier ID not configured in ShipStation Settings')
              }

              const wtUnit  = singularUnit(preset.weightUnit) as 'ounce' | 'pound' | 'gram' | 'kilogram'
              const dimUnit = singularUnit(preset.dimUnit) as 'inch' | 'centimeter'

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
                  ...(preset.insuranceProvider ? { insurance_provider: preset.insuranceProvider as 'parcelguard' | 'carrier' } : {}),
                  packages: [{
                    weight: { unit: wtUnit, value: preset.weightValue },
                    ...(preset.dimLength && preset.dimWidth && preset.dimHeight
                      ? { dimensions: { unit: dimUnit, length: preset.dimLength, width: preset.dimWidth, height: preset.dimHeight } }
                      : {}),
                    ...(preset.insuredValue ? { insured_value: { amount: preset.insuredValue, currency: 'usd' } } : {}),
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
              // Only exclude rates explicitly marked invalid — Amazon Buy Shipping rates often
              // carry address warning messages even though the rate is purchasable.
              const allRates = v2Result.rate_response?.rates ?? []
              // Filter out One Rate services when package dimensions exceed One Rate limits
              // FedEx One Rate max: ~16x15x12 (Extra Large Box). If any dim > 16", One Rate won't fit.
              const maxDim = Math.max(preset.dimLength ?? 0, preset.dimWidth ?? 0, preset.dimHeight ?? 0)
              const v2Rates  = allRates
                .filter(r => r.validation_status !== 'invalid')
                .filter(r => !(maxDim > 16 && /one rate/i.test(r.service_type || r.service_code)))

              console.log('[apply-preset] order=%s v2 rates total=%d valid=%d', order.amazonOrderId, allRates.length, v2Rates.length)

              // Always pick the cheapest Amazon Buy Shipping rate — the preset
              // defines package dimensions/weight but Amazon offers multiple
              // services (UPS Ground, USPS, etc.) and we want the cheapest.
              const sorted = v2Rates.sort((a, b) =>
                (a.shipping_amount.amount + (a.insurance_amount?.amount ?? 0) + a.other_amount.amount) -
                (b.shipping_amount.amount + (b.insurance_amount?.amount ?? 0) + b.other_amount.amount)
              )
              const match = sorted[0]

              if (!match) {
                const statuses = allRates.map(r => `${r.service_code}:${r.validation_status}`).join(', ')
                throw new Error(`No valid Amazon rates returned (${allRates.length} total: ${statuses || 'none'})`)
              }

              rateAmount  = match.shipping_amount.amount + (match.insurance_amount?.amount ?? 0) + match.other_amount.amount
              rateCarrier = match.carrier_friendly_name || match.carrier_code
              rateService = match.service_type || match.service_code
              rateId      = match.rate_id

            } else if (isAmazonCarrier && !orderIsAmazon) {
              // Amazon preset applied to a non-Amazon order (e.g. BackMarket).
              // Amazon Buy Shipping primarily uses UPS, so try ups_walleted first,
              // filtering out USPS services (Mail Innovations / SurePost).
              // Only fall back to all carriers if no UPS rate is found.
              let v1Carriers
              try { v1Carriers = await client.getCarriers() } catch {
                throw new Error('Failed to load ShipStation carriers')
              }
              const nonAmazonCarriers = v1Carriers.filter(c => !c.code.toLowerCase().includes('amazon'))
              if (nonAmazonCarriers.length === 0) {
                throw new Error('No non-Amazon carriers connected to ShipStation. Add UPS/FedEx/USPS to rate BackMarket orders.')
              }

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
                ...(preset.confirmation
                  ? { confirmation: preset.confirmation as 'none' | 'delivery' | 'signature' | 'adult_signature' }
                  : {}),
              }
              const hasDims = !!(preset.dimLength && preset.dimWidth && preset.dimHeight)
              const isFlatRatePkg = preset.packageCode && /flat_rate|envelope|regional_rate/i.test(preset.packageCode)

              // Step 1: Try UPS carrier, filtering out USPS-via-UPS services (SurePost, Mail Innovations)
              const upsCarrier = nonAmazonCarriers.find(c => c.code === 'ups_walleted' || c.code === 'ups')
              let upsRates: { serviceName: string; serviceCode: string; carrierCode: string; shipmentCost: number; otherCost: number; rate_id?: string }[] = []
              if (upsCarrier) {
                try {
                  const raw = await client.getRates({ carrierCode: upsCarrier.code, ...ratePayloadBase })
                  for (const r of raw) {
                    if (hasDims && !isFlatRatePkg && /flat rate|envelope/i.test(r.serviceName)) continue
                    // Exclude USPS services routed through UPS (Mail Innovations, SurePost)
                    if (/usps|surepost|mail innovations/i.test(r.serviceName)) continue
                    upsRates.push(r)
                  }
                } catch (e) {
                  console.warn('[apply-preset] UPS carrier %s error: %s', upsCarrier.code, e instanceof Error ? e.message : String(e))
                }
              }

              let chosen: typeof upsRates[0] | undefined
              if (upsRates.length > 0) {
                // Prefer UPS Ground specifically, otherwise cheapest UPS
                const ground = upsRates.find(r => /ground/i.test(r.serviceName))
                chosen = ground ?? upsRates.sort((a, b) => (a.shipmentCost + a.otherCost) - (b.shipmentCost + b.otherCost))[0]
                console.log('[apply-preset] order=%s BM UPS rate=%s %s $%s', order.amazonOrderId, chosen.carrierCode, chosen.serviceName, (chosen.shipmentCost + chosen.otherCost).toFixed(2))
              } else {
                // Step 2: No UPS rate — fall back to ALL non-Amazon carriers, cheapest wins
                const allV1Rates: typeof upsRates = []
                for (const c of nonAmazonCarriers) {
                  try {
                    const rates = await client.getRates({ carrierCode: c.code, ...ratePayloadBase })
                    for (const r of rates) {
                      if (hasDims && !isFlatRatePkg && /flat rate|envelope/i.test(r.serviceName)) continue
                      allV1Rates.push(r)
                    }
                  } catch (e) {
                    console.warn('[apply-preset] V1 carrier %s error: %s', c.code, e instanceof Error ? e.message : String(e))
                  }
                }
                if (allV1Rates.length === 0) {
                  throw new Error('No valid rates returned from any carrier (UPS/FedEx/USPS)')
                }
                chosen = allV1Rates.sort((a, b) => (a.shipmentCost + a.otherCost) - (b.shipmentCost + b.otherCost))[0]
                console.log('[apply-preset] order=%s BM fallback cheapest=%s %s $%s', order.amazonOrderId, chosen.carrierCode, chosen.serviceName, (chosen.shipmentCost + chosen.otherCost).toFixed(2))
              }

              rateAmount  = chosen.shipmentCost + chosen.otherCost
              rateCarrier = chosen.carrierCode
              rateService = chosen.serviceName
              rateId      = chosen.rate_id ?? null

            } else if (isUpsDirect) {
              // ── UPS Direct path — use UPS API directly with linked credential ──
              let upsWeightValue = preset.weightValue
              const upsWeightUnit: 'LBS' | 'KGS' = /gram|kilo/i.test(preset.weightUnit) ? 'KGS' : 'LBS'
              if (preset.weightUnit === 'ounces') upsWeightValue = preset.weightValue / 16
              else if (preset.weightUnit === 'grams') upsWeightValue = preset.weightValue / 1000

              const upsDimUnit: 'IN' | 'CM' = /cent|cm/i.test(preset.dimUnit) ? 'CM' : 'IN'

              const upsRates = await getUpsDirectRates({
                fromAddress: {
                  line1: from.street1,
                  city: from.city,
                  state: from.state,
                  postal: fromPostalCode,
                  country: from.country || 'US',
                },
                toAddress: {
                  line1: toAddress1,
                  line2: toAddress2,
                  city: toCity,
                  state: toState,
                  postal: toPostalCode,
                  country: toCountry,
                },
                weight: { value: upsWeightValue, unit: upsWeightUnit },
                dimensions: preset.dimLength && preset.dimWidth && preset.dimHeight
                  ? { length: preset.dimLength, width: preset.dimWidth, height: preset.dimHeight, unit: upsDimUnit }
                  : undefined,
                confirmation: (preset.confirmation ?? 'none') as 'none' | 'delivery' | 'signature' | 'adult_signature',
              }, preset.upsCredentialId!)

              if (upsRates.length === 0) throw new Error('No UPS Direct rates returned')

              // If a specific service was chosen, find that; else prefer Ground, else cheapest
              const sorted = upsRates.sort((a, b) => (a.negotiatedCost ?? a.shipmentCost) - (b.negotiatedCost ?? b.shipmentCost))
              const match = preset.serviceCode
                ? sorted.find(r => r.serviceCode === preset.serviceCode) ?? sorted[0]
                : sorted.find(r => /ground/i.test(r.serviceName)) ?? sorted[0]

              const cost = match.negotiatedCost ?? match.shipmentCost
              rateAmount  = cost
              rateCarrier = 'ups_direct'
              rateService = match.serviceName
              rateId      = null

            } else {
              const v1Payload: SSRatesPayload = {
                carrierCode:   preset.carrierCode,
                serviceCode:   preset.serviceCode ?? undefined,
                packageCode:   preset.packageCode ?? undefined,
                fromPostalCode,
                fromCity:      from.city,
                fromState:     from.state,
                toPostalCode,
                toCity:        toCity,
                toState:       toState,
                toCountry:     toCountry,
                weight:        { value: preset.weightValue, units: preset.weightUnit as 'ounces' | 'pounds' | 'grams' | 'kilograms' },
                ...(preset.dimLength && preset.dimWidth && preset.dimHeight
                  ? { dimensions: { units: preset.dimUnit as 'inches' | 'centimeters', length: preset.dimLength, width: preset.dimWidth, height: preset.dimHeight } }
                  : {}),
                ...(preset.confirmation
                  ? { confirmation: preset.confirmation as 'none' | 'delivery' | 'signature' | 'adult_signature' }
                  : {}),
              }

              const v1RatesRaw = await client.getRates(v1Payload)
              const hasDimsV1 = !!(preset.dimLength && preset.dimWidth && preset.dimHeight)
              const isFlatRatePkgV1 = preset.packageCode && /flat_rate|envelope|regional_rate/i.test(preset.packageCode)
              const v1Rates = (hasDimsV1 && !isFlatRatePkgV1) ? v1RatesRaw.filter(r => !/flat rate|envelope/i.test(r.serviceName)) : v1RatesRaw
              console.log('[apply-preset] order=%s v1 rates=%d (raw=%d) serviceCodes=%s',
                order.amazonOrderId, v1Rates.length, v1RatesRaw.length,
                v1Rates.map(r => r.serviceCode).join(', ') || 'none')

              if (!v1Rates || v1Rates.length === 0) {
                throw new Error(
                  `No rates returned from ShipStation for carrier "${preset.carrierCode}"` +
                  (preset.serviceCode ? ` / service "${preset.serviceCode}"` : '') +
                  (preset.packageCode ? ` / package "${preset.packageCode}"` : '') +
                  `. Check that the package type is compatible with One Rate (FedEx One Rate requires a One Rate package code, not "package").`
                )
              }

              const match = preset.serviceCode
                ? v1Rates.find(r => r.serviceCode === preset.serviceCode)
                : v1Rates.sort((a, b) => (a.shipmentCost + a.otherCost) - (b.shipmentCost + b.otherCost))[0]

              if (!match) {
                const available = v1Rates.map(r => r.serviceCode).join(', ')
                throw new Error(`Service "${preset.serviceCode}" not found in rates. Available: ${available}`)
              }

              rateAmount  = match.shipmentCost + match.otherCost
              rateCarrier = match.carrierCode || preset.carrierCode
              rateService = match.serviceName
              rateId      = match.rate_id ?? null
            }

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
                appliedPresetId:     presetId,
              },
            })
            applied++

            send({
              type:        'rate',
              orderId:     order.id,
              amazonOrderId: order.amazonOrderId,
              olmNumber:   order.olmNumber,
              rateAmount,
              rateCarrier,
              rateService,
              rateId,
              error:       null,
            })

          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error('[apply-preset] order=%s carrier=%s error=%s', order.amazonOrderId, preset.carrierCode, msg)
            await prisma.order.update({
              where: { id: order.id },
              data: { presetRateError: msg, presetRateCheckedAt: new Date() },
            })
            errors.push({ orderId: order.id, amazonOrderId: order.amazonOrderId, error: msg })

            send({
              type:          'rate',
              orderId:       order.id,
              amazonOrderId: order.amazonOrderId,
              olmNumber:     order.olmNumber,
              rateAmount:    null,
              rateCarrier:   null,
              rateService:   null,
              rateId:        null,
              error:         msg,
            })
          }

          if (i < orders.length - 1) await sleep(400)
        }

        send({ type: 'done', applied, total: orders.length, errors })

      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
