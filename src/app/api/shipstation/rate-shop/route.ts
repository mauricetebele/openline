import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient, SSRate, V2RatesRequest } from '@/lib/shipstation/client'
import { SpApiClient } from '@/lib/amazon/sp-api'

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

  // ── Load V1 carriers (UPS, FedEx, USPS, Amazon, etc.) ─────────────────────
  let carriers
  try {
    carriers = await client.getCarriers()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load carriers' },
      { status: 502 },
    )
  }

  if (carriers.length === 0) {
    return NextResponse.json({ error: 'No carriers connected to this ShipStation account.' }, { status: 400 })
  }

  console.log('[rate-shop] v1 carriers:', carriers.map(c => c.code))

  const amazonV2CarrierId = account.amazonCarrierId ?? null
  console.log('[rate-shop] amazonV2CarrierId=%s', amazonV2CarrierId)

  // Resolve ShipStation warehouse_id for V2 payloads (required for UPS via Amazon Buy Shipping)
  let ssWarehouseId: string | null = null
  try {
    const ssWarehouses = await client.getWarehouses()
    const wh = ssWarehouses.find(w => body.warehouseId && w.warehouseId === body.warehouseId)
      ?? ssWarehouses.find(w => w.warehouseName.toUpperCase().includes('MERIDIAN'))
      ?? ssWarehouses.find(w => w.isDefault)
      ?? ssWarehouses[0]
    if (wh) ssWarehouseId = `se-${wh.warehouseId}`
  } catch (e) {
    console.warn('[rate-shop] SS warehouse lookup failed:', e instanceof Error ? e.message : String(e))
  }
  console.log('[rate-shop] ssWarehouseId=%s', ssWarehouseId)

  const rateErrors: string[] = []
  const allRates: (SSRate & { carrierName: string })[] = []
  const isAmazonOrder = body.orderSource !== 'backmarket'

  await Promise.all(carriers.map(async carrier => {
    const carrierName = carrier.nickname?.trim() || carrier.name
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
    } else {
      // ── Non-Amazon carriers → V1 getRates per carrier ─────────────────
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
        // Filter out flat rate envelopes/boxes — they ignore actual dimensions
        const hasDims = body.dimensions.length > 0 && body.dimensions.width > 0 && body.dimensions.height > 0
        for (const r of v1Rates) {
          if (hasDims && /flat rate|envelope/i.test(r.serviceName)) continue
          allRates.push({ ...r, carrierName })
        }
        console.log('[rate-shop] V1 %s: %d rates (after filtering)', carrier.code, v1Rates.length)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[rate-shop] V1 %s error:', carrier.code, msg)
        rateErrors.push(`${carrierName}: ${msg}`)
      }
    }
  }))


  allRates.sort((a, b) => (a.shipmentCost + a.otherCost) - (b.shipmentCost + b.otherCost))

  // ── Amazon SP-API MerchantFulfillment (Amazon Buy Shipping rates incl. UPS) ──
  let amazonServices: { code: string; name: string; carrierCode: string; carrierName: string; shipmentCost?: number }[] | undefined
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
        }> } | undefined
        const services = payload?.ShippingServiceList ?? []
        if (services.length > 0) {
          amazonServices = services.map(s => ({
            code: s.ShippingServiceId,
            name: s.ShippingServiceName,
            carrierCode: s.CarrierName,
            carrierName: s.CarrierName,
            shipmentCost: s.Rate?.Amount,
          }))
          console.log('[rate-shop] SP-API MFN: %d services', amazonServices.length)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[rate-shop] SP-API MFN error:', msg)
    }
  }

  return NextResponse.json({ rates: allRates, errors: rateErrors, amazonServices })
}
