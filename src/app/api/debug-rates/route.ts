/**
 * POST /api/debug-rates
 * Debug endpoint: builds the exact V2 rates payload for an Amazon order,
 * sends it to ShipStation, and returns both the request payload and raw response.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    amazonOrderId,
    shipDate,
    weightLb,
    lengthIn,
    widthIn,
    heightIn,
    confirmation = 'none',
  } = body as {
    amazonOrderId: string
    shipDate: string
    weightLb: number
    lengthIn: number
    widthIn: number
    heightIn: number
    confirmation: string
  }

  if (!amazonOrderId) return NextResponse.json({ error: 'amazonOrderId is required' }, { status: 400 })

  // Load order with items and address
  const order = await prisma.order.findFirst({
    where: { amazonOrderId },
    include: {
      items: { select: { orderItemId: true, title: true, quantityOrdered: true } },
    },
  })
  if (!order) return NextResponse.json({ error: `Order ${amazonOrderId} not found` }, { status: 404 })

  // Load ShipStation account
  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true, amazonCarrierId: true },
  })
  if (!account) return NextResponse.json({ error: 'No ShipStation account connected' }, { status: 404 })
  if (!account.v2ApiKeyEnc) return NextResponse.json({ error: 'No V2 API key configured' }, { status: 400 })
  if (!account.amazonCarrierId) return NextResponse.json({ error: 'No Amazon carrier ID configured' }, { status: 400 })

  const v2ApiKey = decrypt(account.v2ApiKeyEnc)
  const ssClient = new ShipStationClient(
    decrypt(account.apiKeyEnc),
    account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '',
  )

  // Get ship-from warehouse from ShipStation (use "MERIDIAN" warehouse)
  let shipFrom = {
    name: 'Warehouse',
    phone: '555-555-5555',
    address_line1: '',
    city_locality: '',
    state_province: '',
    postal_code: '',
    country_code: 'US',
  }
  let warehouseSource = 'fallback'
  try {
    const ssWarehouses = await ssClient.getWarehouses()
    const meridian = ssWarehouses.find(w =>
      w.warehouseName.toUpperCase().includes('MERIDIAN'),
    ) ?? ssWarehouses[0]
    if (meridian) {
      const oa = meridian.originAddress
      shipFrom = {
        name: oa.name || meridian.warehouseName,
        phone: oa.phone || '555-555-5555',
        address_line1: oa.street1 || '',
        city_locality: oa.city || '',
        state_province: oa.state || '',
        postal_code: oa.postalCode || '',
        country_code: oa.country || 'US',
      }
      warehouseSource = `shipstation (${meridian.warehouseName})`
    }
  } catch (e) {
    console.warn('[debug-rates] SS warehouse lookup failed:', e instanceof Error ? e.message : String(e))
    // Fallback to local DB warehouse
    const warehouse = await prisma.warehouse.findFirst({ orderBy: { createdAt: 'asc' } })
    if (warehouse) {
      shipFrom = {
        name: warehouse.name || 'Warehouse',
        phone: warehouse.phone || '555-555-5555',
        address_line1: warehouse.addressLine1 || '',
        city_locality: warehouse.city || '',
        state_province: warehouse.state || '',
        postal_code: warehouse.postalCode || '',
        country_code: warehouse.countryCode || 'US',
      }
      warehouseSource = 'database'
    }
  }

  // Get ship-to address from ShipStation (source of truth, same as main app)
  let shipTo = {
    name: order.shipToName || 'Customer',
    phone: order.shipToPhone || '555-555-5555',
    address_line1: order.shipToAddress1 || '',
    address_line2: order.shipToAddress2 || undefined as string | undefined,
    city_locality: order.shipToCity || '',
    state_province: order.shipToState || '',
    postal_code: (order.shipToPostal || '').split('-')[0].trim(),
    country_code: order.shipToCountry || 'US',
  }

  let addressSource = 'database'
  let ssDebug: unknown = null
  try {
    const ssOrder = await ssClient.findOrderByNumber(order.amazonOrderId)
    ssDebug = ssOrder
      ? { found: true, orderId: ssOrder.orderId, orderNumber: ssOrder.orderNumber, shipTo: ssOrder.shipTo }
      : { found: false }
    if (ssOrder?.shipTo) {
      const st = ssOrder.shipTo
      shipTo = {
        name: st.name || 'Customer',
        phone: st.phone || '555-555-5555',
        address_line1: st.street1 || '',
        address_line2: st.street2 || undefined,
        city_locality: st.city || '',
        state_province: st.state || '',
        postal_code: (st.postalCode || '').split('-')[0].trim(),
        country_code: st.country || 'US',
      }
      addressSource = 'shipstation'
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    ssDebug = { found: false, error: errMsg }
    console.warn('[debug-rates] ShipStation lookup failed, using DB address:', errMsg)
  }

  // Build V2 payload
  const v2Payload = {
    rate_options: {
      carrier_ids: [account.amazonCarrierId],
    },
    shipment: {
      ship_date: shipDate || undefined,
      ship_from: shipFrom,
      ship_to: {
        ...shipTo,
        address_residential_indicator: 'unknown',
      },
      packages: [{
        weight: { unit: 'pound', value: weightLb || 1 },
        dimensions: {
          unit: 'inch',
          length: lengthIn || 1,
          width: widthIn || 1,
          height: heightIn || 1,
        },
      }],
      order_source_code: 'amazon',
      items: order.items.map(item => ({
        name: item.title ?? undefined,
        quantity: item.quantityOrdered,
        external_order_id: order.amazonOrderId,
        external_order_item_id: item.orderItemId,
      })),
    },
  }

  // Also build confirmation info
  if (confirmation && confirmation !== 'none') {
    (v2Payload.shipment as Record<string, unknown>).confirmation = confirmation
  }

  // Send to ShipStation V2
  let rawResponse: unknown = null
  let httpStatus = 0
  let responseHeaders: Record<string, string> = {}

  try {
    const res = await fetch('https://api.shipstation.com/v2/rates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-Key': v2ApiKey,
      },
      body: JSON.stringify(v2Payload),
      signal: AbortSignal.timeout(30000),
    })

    httpStatus = res.status
    res.headers.forEach((v, k) => { responseHeaders[k] = v })

    try {
      rawResponse = await res.json()
    } catch {
      rawResponse = await res.text()
    }
  } catch (err) {
    rawResponse = { fetchError: err instanceof Error ? err.message : String(err) }
  }

  return NextResponse.json({
    order: {
      amazonOrderId: order.amazonOrderId,
      itemCount: order.items.length,
    },
    addressSource,
    warehouseSource,
    shipStationLookup: ssDebug,
    carrierIdUsed: account.amazonCarrierId,
    requestPayload: v2Payload,
    response: {
      httpStatus,
      headers: responseHeaders,
      body: rawResponse,
    },
  })
}
