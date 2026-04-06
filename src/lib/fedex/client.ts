/**
 * FedEx REST API client — OAuth 2.0 + Rate Shopping + Label Purchase.
 * Used for Back Market orders only; Amazon orders use Amazon Buy Shipping.
 */
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import type { SSRate } from '@/lib/shipstation/client'

// ── Types ───────────────────────────────────────────────────────────────────

export interface FedExCredentials {
  clientId: string
  clientSecret: string
  accountNumber: string | null
}

export interface FedExAddress {
  streetLines: string[]
  city: string
  stateOrProvinceCode: string
  postalCode: string
  countryCode: string
  residential?: boolean
}

export interface FedExRateParams {
  shipFrom: FedExAddress
  shipTo: FedExAddress
  weight: { value: number; units: 'LB' | 'KG' }
  dimensions: { length: number; width: number; height: number; units: 'IN' | 'CM' }
  shipDate?: string // YYYY-MM-DD
}

export interface FedExShipmentParams {
  shipFrom: FedExAddress & { personName: string; phone: string }
  shipTo: FedExAddress & { personName: string; phone: string }
  weight: { value: number; units: 'LB' | 'KG' }
  dimensions: { length: number; width: number; height: number; units: 'IN' | 'CM' }
  serviceType: string
  shipDate?: string
}

interface TokenCache {
  accessToken: string
  expiresAt: number // epoch ms
}

// ── In-memory token cache ───────────────────────────────────────────────────

let tokenCache: TokenCache | null = null

const SANDBOX_BASE = 'https://apis-sandbox.fedex.com'
const PROD_BASE = 'https://apis.fedex.com'

function getBaseUrl(testMode?: boolean): string {
  return testMode ? SANDBOX_BASE : PROD_BASE
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export async function loadFedExCredentials(): Promise<FedExCredentials | null> {
  const row = await prisma.fedexShippingCredential.findFirst({ where: { isActive: true } })
  if (!row) return null
  return {
    clientId: decrypt(row.clientIdEnc),
    clientSecret: decrypt(row.clientSecretEnc),
    accountNumber: decrypt(row.accountNumberEnc),
  }
}

async function getAccessToken(creds: FedExCredentials, testMode?: boolean): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken
  }

  const base = getBaseUrl(testMode)
  const res = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      ...(creds.accountNumber ? { account_number: creds.accountNumber } : {}),
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`FedEx OAuth failed (${res.status}): ${text}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 60s early
  }
  return tokenCache.accessToken
}

async function fedexFetch(
  creds: FedExCredentials,
  path: string,
  body: unknown,
  testMode?: boolean,
): Promise<unknown> {
  const token = await getAccessToken(creds, testMode)
  const base = getBaseUrl(testMode)
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`FedEx ${path} failed (${res.status}): ${text}`)
  }

  return res.json()
}

// ── Service code → friendly name mapping ────────────────────────────────────

const SERVICE_NAMES: Record<string, string> = {
  FEDEX_GROUND:                'FedEx Ground',
  GROUND_HOME_DELIVERY:        'FedEx Home Delivery',
  FEDEX_EXPRESS_SAVER:         'FedEx Express Saver',
  FEDEX_2_DAY:                 'FedEx 2Day',
  FEDEX_2_DAY_AM:              'FedEx 2Day AM',
  STANDARD_OVERNIGHT:          'FedEx Standard Overnight',
  PRIORITY_OVERNIGHT:          'FedEx Priority Overnight',
  FIRST_OVERNIGHT:             'FedEx First Overnight',
  FEDEX_FREIGHT_ECONOMY:       'FedEx Freight Economy',
  FEDEX_FREIGHT_PRIORITY:      'FedEx Freight Priority',
  SMART_POST:                  'FedEx SmartPost',
}

// Skip flat-rate / envelope / pak packaging types
const SKIP_PACKAGING = new Set([
  'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_SMALL_BOX', 'FEDEX_MEDIUM_BOX',
  'FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX', 'FEDEX_TUBE',
])

// ── Rate Shopping ───────────────────────────────────────────────────────────

export async function getRates(
  creds: FedExCredentials,
  params: FedExRateParams,
  testMode?: boolean,
): Promise<SSRate[]> {
  const payload = {
    accountNumber: { value: creds.accountNumber },
    rateRequestControlParameters: { returnTransitTimes: true },
    requestedShipment: {
      shipper: { address: params.shipFrom },
      recipient: { address: { ...params.shipTo, residential: params.shipTo.residential } },
      ...(params.shipDate ? { shipDateStamp: params.shipDate } : {}),
      rateRequestType: ['ACCOUNT', 'LIST'],
      pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
      requestedPackageLineItems: [
        {
          weight: { value: params.weight.value, units: params.weight.units },
          ...(params.dimensions.length > 0 && params.dimensions.width > 0 && params.dimensions.height > 0
            ? { dimensions: {
                length: params.dimensions.length,
                width: params.dimensions.width,
                height: params.dimensions.height,
                units: params.dimensions.units,
              } }
            : {}),
        },
      ],
    },
  }

  const data = await fedexFetch(creds, '/rate/v1/rates/quotes', payload, testMode) as {
    output?: {
      rateReplyDetails?: Array<{
        serviceType: string
        serviceName?: string
        packagingType?: string
        ratedShipmentDetails?: Array<{
          totalNetCharge?: number
          totalNetChargeWithDutiesAndTaxes?: number
          rateType?: string
        }>
        commit?: {
          dateDetail?: { dayFormat?: string }
          transitDays?: { description?: string }
        }
      }>
    }
  }

  const details = data?.output?.rateReplyDetails ?? []
  const rates: SSRate[] = []

  for (const d of details) {
    // Skip envelope / flat-rate packaging
    if (d.packagingType && SKIP_PACKAGING.has(d.packagingType)) continue

    // Prefer ACCOUNT rate, fall back to LIST
    const ratedDetail = d.ratedShipmentDetails?.find(r => r.rateType === 'ACCOUNT')
      ?? d.ratedShipmentDetails?.[0]
    if (!ratedDetail) continue

    const cost = ratedDetail.totalNetCharge ?? ratedDetail.totalNetChargeWithDutiesAndTaxes ?? 0

    // Parse transit days
    let transitDays: number | null = null
    const transitDesc = d.commit?.transitDays?.description
    if (transitDesc) {
      const num = parseInt(transitDesc, 10)
      if (!isNaN(num)) transitDays = num
    }

    rates.push({
      serviceName: SERVICE_NAMES[d.serviceType] ?? d.serviceName ?? d.serviceType,
      serviceCode: d.serviceType,
      carrierCode: 'fedex_direct',
      shipmentCost: cost,
      otherCost: 0,
      transitDays,
      deliveryDate: d.commit?.dateDetail?.dayFormat ?? null,
    })
  }

  return rates
}

// ── Label Purchase ──────────────────────────────────────────────────────────

export interface FedExLabelResult {
  trackingNumber: string
  labelData: string // base64 PDF
  labelFormat: string
}

export async function createShipment(
  creds: FedExCredentials,
  params: FedExShipmentParams,
  testMode?: boolean,
): Promise<FedExLabelResult> {
  const payload = {
    accountNumber: { value: creds.accountNumber },
    labelResponseOptions: 'LABEL',
    requestedShipment: {
      shipper: {
        address: {
          streetLines: params.shipFrom.streetLines,
          city: params.shipFrom.city,
          stateOrProvinceCode: params.shipFrom.stateOrProvinceCode,
          postalCode: params.shipFrom.postalCode,
          countryCode: params.shipFrom.countryCode,
        },
        contact: {
          personName: params.shipFrom.personName,
          phoneNumber: params.shipFrom.phone,
        },
      },
      recipients: [
        {
          address: {
            streetLines: params.shipTo.streetLines,
            city: params.shipTo.city,
            stateOrProvinceCode: params.shipTo.stateOrProvinceCode,
            postalCode: params.shipTo.postalCode,
            countryCode: params.shipTo.countryCode,
            residential: params.shipTo.residential,
          },
          contact: {
            personName: params.shipTo.personName,
            phoneNumber: params.shipTo.phone,
          },
        },
      ],
      ...(params.shipDate ? { shipDatestamp: params.shipDate } : {}),
      serviceType: params.serviceType,
      packagingType: 'YOUR_PACKAGING',
      pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
      labelSpecification: {
        labelFormatType: 'COMMON2D',
        imageType: 'PDF',
        labelStockType: 'STOCK_4X6',
      },
      requestedPackageLineItems: [
        {
          weight: { value: params.weight.value, units: params.weight.units },
          dimensions: {
            length: params.dimensions.length,
            width: params.dimensions.width,
            height: params.dimensions.height,
            units: params.dimensions.units,
          },
        },
      ],
    },
  }

  const data = await fedexFetch(creds, '/ship/v1/shipments', payload, testMode) as {
    output?: {
      transactionShipments?: Array<{
        masterTrackingNumber?: string
        pieceResponses?: Array<{
          trackingNumber?: string
          packageDocuments?: Array<{
            encodedLabel?: string
            docType?: string
          }>
        }>
      }>
    }
  }

  const shipment = data?.output?.transactionShipments?.[0]
  if (!shipment) throw new Error('FedEx shipment response missing transactionShipments')

  const trackingNumber = shipment.masterTrackingNumber
    ?? shipment.pieceResponses?.[0]?.trackingNumber
  if (!trackingNumber) throw new Error('FedEx shipment response missing tracking number')

  const labelDoc = shipment.pieceResponses?.[0]?.packageDocuments?.[0]
  if (!labelDoc?.encodedLabel) throw new Error('FedEx shipment response missing label data')

  return {
    trackingNumber,
    labelData: labelDoc.encodedLabel,
    labelFormat: 'pdf',
  }
}
