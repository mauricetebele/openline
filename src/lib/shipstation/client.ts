import WebSocket from 'ws'

const BASE = 'https://ssapi.shipstation.com'

export interface SSCarrier {
  name: string
  code: string
  accountNumber: string | null
  requiresFundedAccount: boolean
  balance: number
  nickname: string | null
  primary: boolean
}

export interface SSRate {
  serviceName: string
  serviceCode: string
  carrierCode: string
  carrierName?: string   // populated by rate-shop endpoint
  shipmentCost: number
  otherCost: number
  transitDays: number | null
  deliveryDate: string | null
  rate_id?: string       // V2 rate ID — present for Amazon Buy Shipping rates
}

export interface SSAddress {
  name: string
  company?: string | null
  street1: string
  street2?: string | null
  city: string
  state: string
  postalCode: string
  country: string
  phone?: string | null
  residential?: boolean
}

export interface SSWeight { value: number; units: 'ounces' | 'grams' | 'pounds' | 'kilograms' }
export interface SSDimensions { units: 'inches' | 'centimeters'; length: number; width: number; height: number }

export interface SSRatesPayload {
  carrierCode: string
  serviceCode?: string
  packageCode?: string
  warehouseId?: number
  orderId?: number
  fromPostalCode?: string  // optional when warehouseId provided
  fromCity?: string
  fromState?: string
  toState?: string         // optional when orderId provided (ShipStation reads from order)
  toCountry?: string
  toPostalCode?: string
  toCity?: string
  weight: SSWeight
  dimensions?: SSDimensions
  confirmation?: 'none' | 'delivery' | 'signature' | 'adult_signature'
  residential?: boolean
  // Amazon Buy Shipping fields (per ShipStation support guidance)
  orderSourceCode?: string
  items?: {
    externalOrderId: string
    externalOrderItemId: string
    name?: string
    quantity?: number
  }[]
}

export interface SSLabelPayload {
  carrierCode: string
  serviceCode: string
  packageCode?: string
  confirmation?: 'none' | 'delivery' | 'signature' | 'adult_signature'
  shipDate: string      // YYYY-MM-DD
  weight: SSWeight
  dimensions: SSDimensions
  shipFrom: SSAddress
  shipTo: SSAddress
  orderNumber?: string
  testLabel?: boolean
}

/** Used by POST /orders/createlabelfororder — creates a label tied to an existing SS order */
export interface SSLabelForOrderPayload {
  orderId: number
  carrierCode: string
  serviceCode: string
  packageCode?: string
  confirmation?: 'none' | 'delivery' | 'signature' | 'adult_signature'
  shipDate: string
  weight: SSWeight
  dimensions?: SSDimensions
  testLabel?: boolean
}

export interface SSLabel {
  shipmentId: number
  trackingNumber: string
  labelData: string        // base64 PDF
  labelResolution: string
  labelFormat: string
  shipmentCost?: number
  insuranceCost?: number
}

/** Minimal shape returned by GET /orders */
export interface SSOrder {
  orderId: number
  orderNumber: string
  orderStatus: string
  shipByDate?: string | null
  shipTo: SSAddress
}

export interface SSCarrierService {
  carrierCode: string
  code: string
  name: string
  domestic: boolean
  international: boolean
}

export interface SSWarehouse {
  warehouseId: number
  warehouseName: string
  originAddress: SSAddress
  returnAddress: SSAddress
  isDefault: boolean
}

// ─── V2 API (ShipEngine-based) ───────────────────────────────────────────────

export interface V2Address {
  name?: string
  company_name?: string
  phone?: string
  address_line1: string
  address_line2?: string
  address_line3?: string
  city_locality: string
  state_province: string
  postal_code: string
  country_code: string
  address_residential_indicator?: 'unknown' | 'yes' | 'no'
}

export interface V2Carrier {
  carrier_id: string | number   // ShipStation V2 returns numeric IDs
  carrier_code: string
  nickname: string
  friendly_name: string
  account_number?: string
  balance?: number
  primary: boolean
}

export interface V2Rate {
  rate_id: string
  rate_type: string
  carrier_id: string
  carrier_code: string
  service_code: string
  service_type: string
  carrier_friendly_name?: string
  shipping_amount: { amount: number; currency: string }
  other_amount: { amount: number; currency: string }
  estimated_delivery_date?: string | null
  carrier_delivery_days?: number | null
  validation_status: string
  warning_messages?: string[]
  error_messages?: string[]
}

export interface V2RatesRequest {
  rate_options: { carrier_ids?: string[] }
  shipment: {
    ship_to: V2Address
    ship_from: V2Address
    packages: {
      weight: { value: number; unit: 'ounce' | 'pound' | 'gram' | 'kilogram' }
      dimensions?: { length: number; width: number; height: number; unit: 'inch' | 'centimeter' }
    }[]
    order_source_code?: string
    items?: {
      name?: string
      quantity?: number
      external_order_id: string
      external_order_item_id: string
    }[]
  }
}

// ─── Internal V3 API (ship{N}.shipstation.com) ────────────────────────────────

export interface SSBrowseRatesPayload {
  fulfillmentPlanId: string
  shipFromId: string
  weight: { unit: string; value: number }
  dimensions: { length: number; width: number; height: number; unit: string }
  packageTypeId: string
  confirmationType: string
  shipToCityOrSuburb: string
  shipToCountryCode: string
  shipToPostalCode: string
  isResidential: boolean
  packages: {
    packageTypeId: string
    description: null
    weight: { value: number; unit: string }
    dimensions: { length: number; width: number; height: number; unit: string }
    insuredValue: { value: number; code: string }
    contentDescription: null
    packageId: string
    isCustom: boolean
  }[]
}

export class ShipStationClient {
  private auth: string
  private apiKey: string   // V1 key (used for ssapi.shipstation.com Basic auth)
  private v2ApiKey: string  // ShipEngine/V2 key (used for api.shipstation.com API-Key header)

  constructor(apiKey: string, apiSecret: string, v2ApiKey?: string | null) {
    this.apiKey   = apiKey
    this.v2ApiKey = v2ApiKey?.trim() || apiKey  // fall back to V1 key if not provided
    this.auth     = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
  }

  private async request<T>(method: string, path: string, body?: unknown, retries = 3): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: this.auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 429 && retries > 0) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '2', 10)
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      return this.request(method, path, body, retries - 1)
    }
    if (!res.ok) {
      let msg = `ShipStation ${res.status}`
      try {
        const json = await res.json()
        // Log full response so we can see all nested exception details
        console.log('[ShipStation error]', method, path, 'status=%d', res.status, JSON.stringify(json, null, 2))
        // Walk the full InnerException chain for the deepest message
        let node = json
        while (node?.InnerException) node = node.InnerException
        const deepest = node?.ExceptionMessage ?? node?.Message
        msg = deepest ?? json.ExceptionMessage ?? json.Message ?? msg
      } catch { /* ignore */ }
      throw new Error(msg)
    }
    return res.json() as Promise<T>
  }

  getCarriers(): Promise<SSCarrier[]> {
    return this.request<SSCarrier[]>('GET', '/carriers')
  }

  getRates(payload: SSRatesPayload): Promise<SSRate[]> {
    return this.request<SSRate[]>('POST', '/shipments/getrates', payload)
  }

  createLabel(payload: SSLabelPayload): Promise<SSLabel> {
    return this.request<SSLabel>('POST', '/shipments/createlabel', payload)
  }

  createLabelForOrder(payload: SSLabelForOrderPayload): Promise<SSLabel> {
    return this.request<SSLabel>('POST', '/orders/createlabelfororder', payload)
  }

  /**
   * Find a ShipStation order by its orderNumber (= Amazon Order ID).
   * Returns the first match or null if not found.
   */
  async findOrderByNumber(orderNumber: string): Promise<SSOrder | null> {
    const resp = await this.request<{ orders: SSOrder[] }>(
      'GET',
      `/orders?orderNumber=${encodeURIComponent(orderNumber)}`,
    )
    return resp.orders?.[0] ?? null
  }

  getWarehouses(): Promise<SSWarehouse[]> {
    return this.request<SSWarehouse[]>('GET', '/warehouses')
  }

  getCarrierServices(carrierCode: string): Promise<SSCarrierService[]> {
    return this.request<SSCarrierService[]>('GET', `/carriers/listservices?carrierCode=${encodeURIComponent(carrierCode)}`)
  }

  getCarrierPackages(carrierCode: string): Promise<{ carrierCode: string; code: string; name: string; domestic: boolean; international: boolean }[]> {
    return this.request('GET', `/carriers/listpackages?carrierCode=${encodeURIComponent(carrierCode)}`)
  }

  // ─── ShipStation V2 API (ShipEngine-based) ───────────────────────────────
  // Per ShipStation support: carrier_name "amazon_shipping", order_source_code
  // "amazon", items[] with external_order_id + external_order_item_id.
  // ship_to must match Amazon Seller Central address (required for validation;
  // Amazon uses its own copy for the actual rating).

  /** GET https://api.shipstation.com/v2/carriers */
  async getV2Carriers(): Promise<{ carriers: V2Carrier[] }> {
    const res = await fetch('https://api.shipstation.com/v2/carriers', {
      headers: { 'API-Key': this.v2ApiKey, Accept: 'application/json' },
    })
    const json = await res.json()
    console.log('[getV2Carriers] status=%d carriers=%d', res.status, (json.carriers ?? []).length)
    if (!res.ok) {
      const msg = json.message ?? json.title ?? `HTTP ${res.status}`
      console.log('[getV2Carriers] error body:', JSON.stringify(json))
      throw new Error(`V2 carriers: ${msg}`)
    }
    return json as { carriers: V2Carrier[] }
  }

  /** POST https://api.shipstation.com/v2/rates */
  async getRatesV2(payload: V2RatesRequest): Promise<{ rate_response: { rates: V2Rate[]; invalid_rates?: V2Rate[] } }> {
    const res = await fetch('https://api.shipstation.com/v2/rates', {
      method: 'POST',
      headers: { 'API-Key': this.v2ApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    console.log('[getRatesV2] status=%d body=%s', res.status, JSON.stringify(json, null, 2))
    if (!res.ok) {
      const firstErr = (json.errors as { message: string }[] | undefined)?.[0]?.message
      throw new Error(firstErr ?? json.message ?? json.title ?? `HTTP ${res.status}`)
    }
    return json as { rate_response: { rates: V2Rate[]; invalid_rates?: V2Rate[] } }
  }

  /**
   * POST https://api.shipstation.com/v2/labels/rates/{rate_id}
   * Purchases a label from a previously obtained V2 rate ID.
   * Returns a shape compatible with SSLabel (trackingNumber + base64 labelData).
   */
  async createLabelV2FromRate(
    rateId: string,
    opts?: { testLabel?: boolean },
  ): Promise<SSLabel> {
    const res = await fetch(`https://api.shipstation.com/v2/labels/rates/${encodeURIComponent(rateId)}`, {
      method: 'POST',
      headers: { 'API-Key': this.v2ApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        validate_address:    'no_validation',
        label_layout:        '4x6',
        label_format:        'pdf',
        label_download_type: 'url',
        test_label:          opts?.testLabel ?? false,
      }),
    })
    const json = await res.json()
    console.log('[createLabelV2FromRate] rateId=%s status=%d body=%s', rateId, res.status, JSON.stringify(json, null, 2))
    if (!res.ok) {
      const firstErr = (json.errors as { message: string }[] | undefined)?.[0]?.message
      throw new Error(firstErr ?? json.message ?? json.title ?? `HTTP ${res.status}`)
    }

    // Resolve label data: try inline base64 first, then fetch the URL
    let labelData: string = json.label_data ?? ''
    if (!labelData) {
      const pdfUrl: string = json.label_download?.href ?? json.label_download?.pdf ?? ''
      if (pdfUrl) {
        console.log('[createLabelV2FromRate] fetching label PDF from URL:', pdfUrl)
        const pdfRes = await fetch(pdfUrl, {
          headers: { 'API-Key': this.v2ApiKey },
        })
        if (pdfRes.ok) {
          const buf = await pdfRes.arrayBuffer()
          labelData = Buffer.from(buf).toString('base64')
        } else {
          console.error('[createLabelV2FromRate] failed to fetch PDF URL status=%d', pdfRes.status)
        }
      }
    }

    return {
      shipmentId:     json.shipment_id ?? 0,
      trackingNumber: json.tracking_number ?? '',
      labelData,
      labelResolution: '300',
      labelFormat:    'pdf',
      shipmentCost:   json.shipment_cost?.amount,
    }
  }

  /**
   * GET /shipments?trackingNumber=xxx
   * Looks up a shipment by tracking number and returns the first match.
   */
  async findShipmentByTracking(trackingNumber: string): Promise<{ shipmentId: number } | null> {
    const resp = await this.request<{ shipments: { shipmentId: number }[] }>(
      'GET',
      `/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`,
    )
    return resp.shipments?.[0] ?? null
  }

  /**
   * POST /shipments/voidlabel
   * Requests a void (cancellation) of a purchased label by ShipStation shipmentId.
   */
  voidLabel(shipmentId: number): Promise<{ approved: boolean; message: string }> {
    return this.request('POST', '/shipments/voidlabel', { shipmentId })
  }

  /** Quick connectivity test */
  async testConnection(): Promise<void> {
    await this.getCarriers()
  }

  /**
   * POST https://ship{partition}.shipstation.com/api/rate/browse
   * ShipStation delivers rate results asynchronously via Pusher WebSocket.
   * Flow: connect Pusher → auth presence channel → subscribe → POST browse → await rate-browser event.
   */
  async browseRates(
    bearerJwt: string,
    partition: number,
    sellerId: string,
    userId: string,
    payload: SSBrowseRatesPayload,
  ): Promise<unknown> {
    const PUSHER_KEY = '9d37aa3c7de87cc583ae'
    const PUSHER_URL = `wss://ws-mt1.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=8.3.0&flash=false`
    const baseInternal = `https://ship${partition}.shipstation.com`
    const authHeaders = {
      Authorization: `Bearer ${bearerJwt}`,
      Accept: 'application/json, text/plain, */*',
      'x-ss-sellerid': sellerId,
      'x-ss-userid': userId,
    }

    return new Promise((resolve, reject) => {
      let ws: WebSocket | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      let browsePosted = false
      let expectedGuid: string | null = null

      const cleanup = () => {
        if (timer) { clearTimeout(timer); timer = null }
        if (ws) { try { ws!.close() } catch {} ws = null }
      }
      const fail    = (msg: string) => { cleanup(); reject(new Error(msg)) }
      const succeed = (data: unknown) => { cleanup(); resolve(data) }

      timer = setTimeout(() => fail('Amazon Buy Shipping: no rates received via Pusher in 45s'), 45000)

      ws = new WebSocket(PUSHER_URL)

      ws.on('error', err => fail(`Pusher WebSocket error: ${err.message}`))

      ws.on('message', async (raw) => {
        let msg: { event: string; data: unknown; channel?: string }
        try { msg = JSON.parse(String(raw)) } catch { return }
        const { event } = msg

        // ── Connected: perform USER auth ──────────────────────────────────
        if (event === 'pusher:connection_established') {
          const connData = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data
          const socketId = (connData as { socket_id: string }).socket_id
          console.log('[Pusher] connected socket_id=%s', socketId)

          // Try multiple auth endpoints/approaches in order
          const authAttempts = [
            { endpoint: '/api/pusher/auth',      body: { socket_id: socketId } },
            { endpoint: '/api/pusher/user-auth', body: { socket_id: socketId } },
            { endpoint: '/api/pusher/auth',      body: { socket_id: socketId, channel_name: `#user-${userId}` } },
          ]

          let authData: { auth: string; user_data?: string } | null = null
          for (const attempt of authAttempts) {
            try {
              const authRes = await fetch(`${baseInternal}${attempt.endpoint}`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${bearerJwt}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                  Accept: 'application/json',
                  Origin: baseInternal,
                },
                body: new URLSearchParams(attempt.body).toString(),
              })
              const text = await authRes.text()
              console.log('[Pusher] auth attempt %s body=%s status=%d response=%s',
                attempt.endpoint, JSON.stringify(attempt.body), authRes.status, text.slice(0, 200))
              if (authRes.ok) {
                authData = JSON.parse(text)
                break
              }
            } catch (err) {
              console.log('[Pusher] auth attempt %s error: %s', attempt.endpoint, err instanceof Error ? err.message : err)
            }
          }

          if (!authData) {
            return fail('Pusher user auth failed — all attempts returned 401. Check the session token in ShipStation Settings.')
          }

          console.log('[Pusher] user-auth ok — signing in')
          ws!.send(JSON.stringify({
            event: 'pusher:signin',
            data: { auth: authData.auth, user_data: authData.user_data ?? '' },
          }))

        // ── Signed in: fire the browse POST ──────────────────────────────
        } else if (event === 'pusher:signin_success') {
          console.log('[Pusher] signin_success — posting browse…')
          if (browsePosted) return
          browsePosted = true

          try {
            const browseRes = await fetch(`${baseInternal}/api/rate/browse`, {
              method: 'POST',
              headers: { ...authHeaders, 'Content-Type': 'application/json; charset=UTF-8' },
              body: JSON.stringify(payload),
            })
            if (browseRes.status === 401) {
              return fail('ShipStation session expired — please refresh your session token in ShipStation settings')
            }
            if (!browseRes.ok) {
              let errMsg = `Browse POST ${browseRes.status}`
              try { const j = await browseRes.json(); errMsg = (j.message ?? j.Message ?? j.error ?? errMsg) as string } catch {}
              return fail(errMsg)
            }
            const browseData = await browseRes.json() as { jobGuids?: string[] }
            expectedGuid = browseData?.jobGuids?.[0] ?? null
            console.log('[Pusher] browse posted, expectedGuid=%s', expectedGuid)
          } catch (err) {
            return fail(`Browse POST error: ${err instanceof Error ? err.message : String(err)}`)
          }

        // ── Rate results delivered via Pusher ─────────────────────────────
        } else if (event === 'rate-browser') {
          console.log('[Pusher] rate-browser event on channel=%s', msg.channel)
          let eventData: { messageGuid?: string; data?: unknown }
          try { eventData = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data as typeof eventData } catch { return }

          if (!expectedGuid || eventData.messageGuid === expectedGuid) {
            console.log('[Pusher] rates received, messageGuid=%s', eventData.messageGuid)
            succeed(eventData.data ?? eventData)
          } else {
            console.log('[Pusher] ignoring event guid=%s (expected %s)', eventData.messageGuid, expectedGuid)
          }

        } else if (event === 'pusher:error') {
          console.error('[Pusher] error event:', JSON.stringify(msg.data))
        }
      })
    })
  }
}
