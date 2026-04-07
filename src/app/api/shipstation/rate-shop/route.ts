import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient, SSRate, V2RatesRequest } from '@/lib/shipstation/client'
import { SpApiClient } from '@/lib/amazon/sp-api'
import { loadFedExCredentials, getRates as getFedExRates, type FedExRateParams } from '@/lib/fedex/client'

export const dynamic = 'force-dynamic'

interface OrderItem {
  orderItemId: string
  title?: string | null
  quantity: number
}

interface RateShopPayload {
  warehouseId?: number
  orderId?: number
  fromPostalCode: string
  fromCity?: string
  fromState?: string
  fromAddress1?: string
  fromName?: string
  fromPhone?: string | null
  fromCountry?: string
  toState: string
  toCountry: string
  toPostalCode: string
  toCity: string
  toName?: string
  toPhone?: string | null
  toAddress1?: string
  toAddress2?: string | null
  weight: { value: number; units: string }
  dimensions: { units: string; length: number; width: number; height: number }
  confirmation?: string
  residential?: boolean
  amazonOrderId?: string
  orderItems?: OrderItem[]
  orderSource?: string  // 'amazon' | 'backmarket' — controls which carriers to query
  shipDate?: string     // YYYY-MM-DD — future ship date for rate shopping
  fedexPackaging?: string // FedEx One Rate packaging type, e.g. 'FEDEX_PAK'
}

/** 'ounces' → 'ounce', 'pounds' → 'pound', 'inches' → 'inch', etc. (V2 uses singular units) */
const UNIT_SINGULAR: Record<string, string> = {
  ounces: 'ounce', pounds: 'pound', grams: 'gram', kilograms: 'kilogram',
  inches: 'inch', centimeters: 'centimeter',
}
function singularUnit(s: string): string {
  return UNIT_SINGULAR[s] ?? s.replace(/s$/, '')
}

const isAmazonCarrier = (code: string) => code.toLowerCase().includes('amazon')

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: {
      apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true, amazonCarrierId: true,
    },
  })
  if (!account) return NextResponse.json({ error: 'No ShipStation account connected' }, { status: 404 })

  const body: RateShopPayload = await req.json()
  body.toPostalCode   = body.toPostalCode?.split('-')[0].trim()
  body.fromPostalCode = body.fromPostalCode?.split('-')[0].trim()

  console.log('[rate-shop] orderId=%s warehouseId=%s toPostalCode=%s', body.orderId, body.warehouseId, body.toPostalCode)

  const v2ApiKey = account.v2ApiKeyEnc ? decrypt(account.v2ApiKeyEnc) : null
  const client = new ShipStationClient(decrypt(account.apiKeyEnc), account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '', v2ApiKey)

  const amazonV2CarrierId = account.amazonCarrierId ?? null
  const isAmazonOrder = body.orderSource !== 'backmarket'

  // ── Load carriers, warehouses, and V2 carrier map in parallel ───────────
  const [carriersResult, warehouseResult, v2CarriersResult] = await Promise.all([
    client.getCarriers().catch((err: unknown) => ({ error: err instanceof Error ? err.message : 'Failed to load carriers' })),
    client.getWarehouses().catch(() => [] as Awaited<ReturnType<typeof client.getWarehouses>>),
    (v2ApiKey && !isAmazonOrder)
      ? client.getV2Carriers().catch((e: unknown) => { console.warn('[rate-shop] V2 carriers lookup failed, will use V1:', e instanceof Error ? e.message : String(e)); return null })
      : Promise.resolve(null),
  ])

  if ('error' in carriersResult) {
    return NextResponse.json({ error: carriersResult.error }, { status: 502 })
  }
  const carriers = carriersResult
  if (carriers.length === 0) {
    return NextResponse.json({ error: 'No carriers connected to this ShipStation account.' }, { status: 400 })
  }
  console.log('[rate-shop] v1 carriers:', carriers.map(c => c.code))
  console.log('[rate-shop] amazonV2CarrierId=%s', amazonV2CarrierId)

  let ssWarehouseId: string | null = null
  const wh = warehouseResult.find(w => body.warehouseId && w.warehouseId === body.warehouseId)
    ?? warehouseResult.find(w => w.warehouseName.toUpperCase().includes('MERIDIAN'))
    ?? warehouseResult.find(w => w.isDefault)
    ?? warehouseResult[0]
  if (wh) ssWarehouseId = `se-${wh.warehouseId}`
  console.log('[rate-shop] ssWarehouseId=%s', ssWarehouseId)

  const v2CarrierMap: Map<string, string> | null = v2CarriersResult
    ? new Map(v2CarriersResult.carriers.map(c => [c.carrier_code, String(c.carrier_id)]))
    : null

  const rateErrors: string[] = []
  const allRates: (SSRate & { carrierName: string })[] = []

  await Promise.all(carriers.map(async carrier => {
    const carrierName = carrier.name
    const isAmzCarrier = isAmazonCarrier(carrier.code)

    // Non-Amazon orders skip Amazon carriers; Amazon orders ONLY use Amazon Buy Shipping
    if (!isAmazonOrder && isAmzCarrier) return
    if (isAmazonOrder && !isAmzCarrier) return

    if (isAmzCarrier) {
      // ── Amazon Buy Shipping → V2 API ──────────────────────────────────
      if (!amazonV2CarrierId) {
        rateErrors.push('Amazon Buy Shipping: no carrier ID configured — set it in ShipStation Settings')
        return
      }

      const wtUnit  = singularUnit(body.weight.units) as 'ounce' | 'pound' | 'gram' | 'kilogram'
      const dimUnit = singularUnit(body.dimensions.units) as 'inch' | 'centimeter'

      const v2Payload: V2RatesRequest = {
        rate_options: { carrier_ids: [amazonV2CarrierId] },
        shipment: {
          ...(body.shipDate ? { ship_date: `${body.shipDate}` } : {}),
          ...(ssWarehouseId
            ? { warehouse_id: ssWarehouseId }
            : { ship_from: {
                name:            body.fromName || 'Warehouse',
                phone:           body.fromPhone || '555-555-5555',
                address_line1:   body.fromAddress1 ?? '',
                city_locality:   body.fromCity ?? '',
                state_province:  body.fromState ?? '',
                postal_code:     body.fromPostalCode,
                country_code:    body.fromCountry ?? 'US',
              } }),
          ship_to: {
            name:                          body.toName || 'Customer',
            phone:                         body.toPhone || '555-555-5555',
            address_line1:                 body.toAddress1 ?? '',
            address_line2:                 body.toAddress2 ?? undefined,
            city_locality:                 body.toCity,
            state_province:                body.toState,
            postal_code:                   body.toPostalCode,
            country_code:                  body.toCountry,
            address_residential_indicator: body.residential ? 'yes' : 'unknown',
          },
          packages: [{
            weight:     { unit: wtUnit,  value: body.weight.value },
            dimensions: { unit: dimUnit, length: body.dimensions.length, width: body.dimensions.width, height: body.dimensions.height },
          }],
          order_source_code: 'amazon',
          items: body.orderItems?.map(item => ({
            name:                    item.title ?? undefined,
            quantity:                item.quantity,
            external_order_id:       body.amazonOrderId ?? '',
            external_order_item_id:  item.orderItemId,
          })),
        },
      }

      console.log('[rate-shop] V2 payload:', JSON.stringify(v2Payload, null, 2))
      try {
        const v2Result = await client.getRatesV2(v2Payload)
        const v2Rates  = v2Result.rate_response?.rates ?? []
        console.log('[rate-shop] V2 rates: %d valid, %d invalid',
          v2Rates.length, v2Result.rate_response?.invalid_rates?.length ?? 0)

        const mapped = v2Rates
          .filter(r => r.validation_status !== 'invalid' && !r.error_messages?.length)
          .map(r => ({
            serviceName:  r.service_type || r.service_code,
            serviceCode:  r.service_code,
            carrierCode:  r.carrier_friendly_name || r.carrier_code,
            carrierName,
            shipmentCost: r.shipping_amount?.amount ?? 0,
            otherCost:    r.other_amount?.amount ?? 0,
            transitDays:  r.carrier_delivery_days ?? null,
            deliveryDate: r.estimated_delivery_date ?? null,
            rate_id:      r.rate_id,
          } as SSRate & { carrierName: string }))

        for (const r of mapped) allRates.push(r)

        if (mapped.length === 0) {
          const invalids = v2Result.rate_response?.invalid_rates ?? []
          const firstErr = invalids[0]?.error_messages?.[0]
          rateErrors.push(`Amazon Buy Shipping: no rates returned${firstErr ? ` — ${firstErr}` : ''}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[rate-shop] V2 error:', msg)
        rateErrors.push(`Amazon Buy Shipping: ${msg}`)
      }
    } else if (v2CarrierMap?.has(carrier.code)) {
      // ── Non-Amazon carriers → V2 getRates (returns delivery dates) ────
      const wtUnit  = singularUnit(body.weight.units) as 'ounce' | 'pound' | 'gram' | 'kilogram'
      const dimUnit = singularUnit(body.dimensions.units) as 'inch' | 'centimeter'
      const v2CarrierId = v2CarrierMap.get(carrier.code)!

      try {
        const v2Payload: V2RatesRequest = {
          rate_options: { carrier_ids: [v2CarrierId] },
          shipment: {
            ...(body.shipDate ? { ship_date: `${body.shipDate}` } : {}),
            ...(ssWarehouseId
              ? { warehouse_id: ssWarehouseId }
              : { ship_from: {
                  name:            body.fromName || 'Warehouse',
                  phone:           body.fromPhone || '555-555-5555',
                  address_line1:   body.fromAddress1 ?? '',
                  city_locality:   body.fromCity ?? '',
                  state_province:  body.fromState ?? '',
                  postal_code:     body.fromPostalCode,
                  country_code:    body.fromCountry ?? 'US',
                } }),
            ship_to: {
              name:                          body.toName || 'Customer',
              phone:                         body.toPhone || '555-555-5555',
              address_line1:                 body.toAddress1 ?? '',
              address_line2:                 body.toAddress2 ?? undefined,
              city_locality:                 body.toCity,
              state_province:                body.toState,
              postal_code:                   body.toPostalCode,
              country_code:                  body.toCountry,
              address_residential_indicator: body.residential ? 'yes' : 'unknown',
            },
            packages: [{
              weight:     { unit: wtUnit,  value: body.weight.value },
              dimensions: { unit: dimUnit, length: body.dimensions.length, width: body.dimensions.width, height: body.dimensions.height },
            }],
          },
        }

        const v2Result = await client.getRatesV2(v2Payload)
        const v2Rates = v2Result.rate_response?.rates ?? []
        const hasDims = body.dimensions.length > 0 && body.dimensions.width > 0 && body.dimensions.height > 0
        const mapped = v2Rates
          .filter(r => r.validation_status !== 'invalid' && !r.error_messages?.length)
          .filter(r => !(hasDims && /flat rate|envelope/i.test(r.service_type || '')))
          .map(r => ({
            serviceName:  r.service_type || r.service_code,
            serviceCode:  r.service_code,
            carrierCode:  r.carrier_friendly_name || r.carrier_code,
            carrierName,
            shipmentCost: r.shipping_amount?.amount ?? 0,
            otherCost:    r.other_amount?.amount ?? 0,
            transitDays:  r.carrier_delivery_days ?? null,
            deliveryDate: r.estimated_delivery_date ?? null,
            rate_id:      r.rate_id,
          } as SSRate & { carrierName: string }))

        for (const r of mapped) allRates.push(r)
        console.log('[rate-shop] V2 %s: %d rates', carrier.code, mapped.length)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[rate-shop] V2 %s error:', carrier.code, msg)
        rateErrors.push(`${carrierName}: ${msg}`)
      }
    } else {
      // ── V1 getRates per carrier (no delivery dates available) ──────────
      const v1Payload: import('@/lib/shipstation/client').SSRatesPayload = {
        carrierCode:    carrier.code,
        fromPostalCode: body.fromPostalCode,
        fromCity:       body.fromCity,
        fromState:      body.fromState,
        toPostalCode:   body.toPostalCode,
        toCity:         body.toCity,
        toState:        body.toState,
        toCountry:      body.toCountry ?? 'US',
        weight:         { value: body.weight.value, units: body.weight.units },
        dimensions:     { units: body.dimensions.units, length: body.dimensions.length, width: body.dimensions.width, height: body.dimensions.height },
        confirmation:   (body.confirmation ?? 'none') as 'none' | 'delivery' | 'signature' | 'adult_signature',
        residential:    body.residential,
      }

      try {
        const v1Rates = await client.getRates(v1Payload)
        const hasDims = body.dimensions.length > 0 && body.dimensions.width > 0 && body.dimensions.height > 0
        for (const r of v1Rates) {
          if (hasDims && /flat rate|envelope/i.test(r.serviceName)) continue
          // V1 getrates doesn't return carrierCode in each rate — inject it from the carrier being queried
          allRates.push({ ...r, carrierCode: r.carrierCode || carrier.code, carrierName })
        }
        console.log('[rate-shop] V1 %s: %d rates (after filtering)', carrier.code, v1Rates.length)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[rate-shop] V1 %s error:', carrier.code, msg)
        rateErrors.push(`${carrierName}: ${msg}`)
      }
    }
  }))

  // ── FedEx Direct rates (Back Market orders only) ─────────────────────────
  let fedexDebug: { credentialsFound: boolean; requestParams?: unknown; rateCount?: number; oneRatePackaging?: string; oneRateCount?: number; error?: string } | undefined
  if (!isAmazonOrder) {
    try {
      const fedexCreds = await loadFedExCredentials()
      fedexDebug = { credentialsFound: !!fedexCreds }
      if (fedexCreds) {
        const weightUnits = /pound|lb/i.test(body.weight.units) ? 'LB' as const : 'KG' as const
        const dimUnits = /inch|in/i.test(body.dimensions.units) ? 'IN' as const : 'CM' as const
        let weightValue = body.weight.value
        if (/ounce|oz/i.test(body.weight.units)) {
          weightValue = Math.round((weightValue / 16) * 100) / 100
        }

        const fedexParams: FedExRateParams = {
          shipFrom: {
            streetLines: body.fromAddress1 ? [body.fromAddress1] : [],
            city: body.fromCity ?? '',
            stateOrProvinceCode: body.fromState ?? '',
            postalCode: body.fromPostalCode,
            countryCode: body.fromCountry ?? 'US',
          },
          shipTo: {
            streetLines: body.toAddress1 ? [body.toAddress1] : [],
            city: body.toCity,
            stateOrProvinceCode: body.toState,
            postalCode: body.toPostalCode,
            countryCode: body.toCountry ?? 'US',
            residential: body.residential,
          },
          weight: { value: weightValue, units: weightUnits },
          dimensions: { length: body.dimensions.length, width: body.dimensions.width, height: body.dimensions.height, units: dimUnits },
          shipDate: body.shipDate,
        }

        fedexDebug.requestParams = { weight: fedexParams.weight, dimensions: fedexParams.dimensions, fromZip: fedexParams.shipFrom.postalCode, toZip: fedexParams.shipTo.postalCode }
        console.log('[rate-shop] FedEx params: weight=%j dims=%j', fedexParams.weight, fedexParams.dimensions)

        // Standard rates + optional One Rate in parallel
        const wantOneRate = body.fedexPackaging && body.fedexPackaging !== 'none'
        if (wantOneRate) fedexDebug.oneRatePackaging = body.fedexPackaging

        const ratePromises: Promise<{ rates: typeof allRates; count: number }>[] = [
          getFedExRates(fedexCreds, fedexParams).then(rates => ({
            rates: rates.map(r => ({ ...r, carrierName: 'FedEx Direct' })),
            count: rates.length,
          })),
        ]

        if (wantOneRate) {
          const oneRateParams: FedExRateParams = {
            ...fedexParams,
            packagingType: body.fedexPackaging!,
            oneRate: true,
          }
          ratePromises.push(
            getFedExRates(fedexCreds, oneRateParams).then(rates => ({
              rates: rates.map(r => ({ ...r, carrierName: 'FedEx Direct' })),
              count: rates.length,
            })),
          )
        }

        const results = await Promise.all(ratePromises)
        for (const r of results[0].rates) allRates.push(r)
        fedexDebug.rateCount = results[0].count

        if (results[1]) {
          for (const r of results[1].rates) allRates.push(r)
          fedexDebug.oneRateCount = results[1].count
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[rate-shop] FedEx Direct error:', msg)
      rateErrors.push(`FedEx Direct: ${msg}`)
      if (fedexDebug) fedexDebug.error = msg
    }
  }

  allRates.sort((a, b) => (a.shipmentCost + a.otherCost) - (b.shipmentCost + b.otherCost))

  // ── Amazon SP-API MerchantFulfillment (Amazon Buy Shipping rates incl. UPS) ──
  let amazonServices: { code: string; name: string; carrierCode: string; carrierName: string; shipmentCost?: number; latestDeliveryDate?: string }[] | undefined
  if (isAmazonOrder && body.amazonOrderId) {
    try {
      const order = await prisma.order.findFirst({
        where: { amazonOrderId: body.amazonOrderId },
        select: { accountId: true, amazonOrderId: true, items: { select: { orderItemId: true, quantityOrdered: true } } },
      })
      if (order) {
        const spClient = new SpApiClient(order.accountId)
        const mfnPayload = {
          ShipmentRequestDetails: {
            AmazonOrderId: order.amazonOrderId,
            ItemList: order.items.map(item => ({
              OrderItemId: item.orderItemId,
              Quantity: item.quantityOrdered,
            })),
            ShipFromAddress: {
              Name: body.fromName ?? 'Warehouse',
              AddressLine1: body.fromAddress1 ?? '',
              City: body.fromCity ?? '',
              StateOrProvinceCode: body.fromState ?? '',
              PostalCode: body.fromPostalCode,
              CountryCode: body.fromCountry ?? 'US',
              Phone: body.fromPhone ?? '555-555-5555',
            },
            PackageDimensions: {
              Length: body.dimensions.length,
              Width: body.dimensions.width,
              Height: body.dimensions.height,
              Unit: body.dimensions.units === 'inches' ? 'inches' : body.dimensions.units,
            },
            Weight: {
              Value: body.weight.units === 'pounds'
                ? body.weight.value * 16  // SP-API expects ounces
                : body.weight.value,
              Unit: 'ounces',
            },
            ShippingServiceOptions: {
              DeliveryExperience: 'DeliveryConfirmationWithoutSignature',
              CarrierWillPickUp: false,
              CarrierWillPickUpOption: 'ShipperWillDropOff',
            },
          },
        }
        const resp = await spClient.post('/mfn/v0/eligibleShippingServices', mfnPayload)
        const payload = (resp as Record<string, unknown>)?.payload as { ShippingServiceList?: Array<{
          ShippingServiceId: string; ShippingServiceName: string
          CarrierName: string; Rate?: { Amount?: number; CurrencyCode?: string }
          LatestEstimatedDeliveryDate?: string; EarliestEstimatedDeliveryDate?: string
        }> } | undefined
        const services = payload?.ShippingServiceList ?? []
        if (services.length > 0) {
          amazonServices = services.map(s => ({
            code: s.ShippingServiceId,
            name: s.ShippingServiceName,
            carrierCode: s.CarrierName,
            carrierName: s.CarrierName,
            shipmentCost: s.Rate?.Amount,
            latestDeliveryDate: s.LatestEstimatedDeliveryDate ?? s.EarliestEstimatedDeliveryDate,
          }))
          console.log('[rate-shop] SP-API MFN: %d services', amazonServices.length)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[rate-shop] SP-API MFN error:', msg)
    }
  }

  return NextResponse.json({ rates: allRates, errors: rateErrors, amazonServices, fedexDebug })
}
