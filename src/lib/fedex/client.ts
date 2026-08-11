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

export type FedExSignatureType = 'DIRECT' | 'INDIRECT' | 'ADULT' | 'NO_SIGNATURE_REQUIRED'

export interface FedExRateParams {
  shipFrom: FedExAddress
  shipTo: FedExAddress
  weight: { value: number; units: 'LB' | 'KG' }
  dimensions?: { length: number; width: number; height: number; units: 'IN' | 'CM' }
  shipDate?: string // YYYY-MM-DD
  packagingType?: string  // e.g. 'FEDEX_PAK' — defaults to YOUR_PACKAGING
  oneRate?: boolean       // when true, requests FedEx One Rate (flat-rate) pricing
  signatureType?: FedExSignatureType // signature required option
}

export interface FedExShipmentParams {
  shipFrom: FedExAddress & { personName: string; phone: string }
  shipTo: FedExAddress & { personName: string; phone: string }
  weight: { value: number; units: 'LB' | 'KG' }
  dimensions: { length: number; width: number; height: number; units: 'IN' | 'CM' }
  serviceType: string
  shipDate?: string
  packagingType?: string  // e.g. 'FEDEX_PAK' — for One Rate labels
  oneRate?: boolean       // when true, adds FEDEX_ONE_RATE special service
  signatureType?: FedExSignatureType // signature required option
}

interface TokenCache {
  accessToken: string
  expiresAt: number // epoch ms
}

// ── In-memory token cache (separate for prod vs sandbox) ────────────────────

let prodTokenCache: TokenCache | null = null
let testTokenCache: TokenCache | null = null

const SANDBOX_BASE = 'https://apis-sandbox.fedex.com'
const PROD_BASE = 'https://apis.fedex.com'

function getBaseUrl(testMode?: boolean): string {
  return testMode ? SANDBOX_BASE : PROD_BASE
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export async function loadFedExCredentials(testMode?: boolean): Promise<FedExCredentials | null> {
  const row = await prisma.fedexShippingCredential.findFirst({ where: { isActive: true } })
  if (!row) return null

  // Use test (sandbox) credentials when testMode is true and they exist
  if (testMode && row.testClientIdEnc && row.testClientSecretEnc && row.testAccountNumberEnc) {
    return {
      clientId: decrypt(row.testClientIdEnc),
      clientSecret: decrypt(row.testClientSecretEnc),
      accountNumber: decrypt(row.testAccountNumberEnc),
    }
  }

  return {
    clientId: decrypt(row.clientIdEnc),
    clientSecret: decrypt(row.clientSecretEnc),
    accountNumber: decrypt(row.accountNumberEnc),
  }
}

async function getAccessToken(creds: FedExCredentials, testMode?: boolean): Promise<string> {
  const cache = testMode ? testTokenCache : prodTokenCache
  if (cache && Date.now() < cache.expiresAt) {
    return cache.accessToken
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
  const newToken: TokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 60s early
  }
  if (testMode) testTokenCache = newToken; else prodTokenCache = newToken
  return newToken.accessToken
}

async function fedexFetch(
  creds: FedExCredentials,
  path: string,
  body: unknown,
  testMode?: boolean,
  method: 'POST' | 'PUT' = 'POST',
): Promise<unknown> {
  const token = await getAccessToken(creds, testMode)
  const base = getBaseUrl(testMode)
  const res = await fetch(`${base}${path}`, {
    method,
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
      packagingType: params.packagingType ?? 'YOUR_PACKAGING',
      ...(params.oneRate ? { shipmentSpecialServices: { specialServiceTypes: ['FEDEX_ONE_RATE'] } } : {}),
      requestedPackageLineItems: [
        {
          weight: { value: params.weight.value, units: params.weight.units },
          // One Rate uses FedEx packaging dimensions — skip custom dims; also skip if no dims provided
          // FedEx requires integer dimensions — round up decimals
          ...(!params.oneRate && params.dimensions && params.dimensions.length > 0 && params.dimensions.width > 0 && params.dimensions.height > 0
            ? { dimensions: {
                length: Math.ceil(params.dimensions.length),
                width: Math.ceil(params.dimensions.width),
                height: Math.ceil(params.dimensions.height),
                units: params.dimensions.units,
              } }
            : {}),
          ...(params.signatureType && params.signatureType !== 'NO_SIGNATURE_REQUIRED'
            ? { packageSpecialServices: { signatureOptionType: params.signatureType } }
            : {}),
        },
      ],
    },
  }

  console.log('[fedex-rates] payload:', JSON.stringify(payload.requestedShipment.requestedPackageLineItems))

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
    // For standard (non-One-Rate) requests, skip envelope / flat-rate packaging types
    if (!params.oneRate && d.packagingType && SKIP_PACKAGING.has(d.packagingType)) continue

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

    const baseName = SERVICE_NAMES[d.serviceType] ?? d.serviceName ?? d.serviceType
    rates.push({
      serviceName: params.oneRate ? `${baseName} (One Rate)` : baseName,
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
  // FedEx consolidated Ground Home Delivery into FEDEX_GROUND —
  // residential routing is determined by the address residential flag.
  const serviceType = params.serviceType === 'GROUND_HOME_DELIVERY'
    ? 'FEDEX_GROUND' : params.serviceType

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
      serviceType,
      packagingType: params.packagingType ?? 'YOUR_PACKAGING',
      pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
      shippingChargesPayment: {
        paymentType: 'SENDER',
        payor: { responsibleParty: { accountNumber: { value: creds.accountNumber } } },
      },
      ...(params.oneRate ? { shipmentSpecialServices: { specialServiceTypes: ['FEDEX_ONE_RATE'] } } : {}),
      labelSpecification: {
        labelFormatType: 'COMMON2D',
        imageType: testMode ? 'PNG' : 'PDF',
        ...(testMode ? {} : { labelStockType: 'STOCK_4X6' }),
      },
      requestedPackageLineItems: [
        {
          weight: { value: params.weight.value, units: params.weight.units },
          // One Rate uses FedEx packaging dimensions — skip custom dims
          ...(!params.oneRate ? { dimensions: {
            length: params.dimensions.length,
            width: params.dimensions.width,
            height: params.dimensions.height,
            units: params.dimensions.units,
          } } : {}),
          ...(params.signatureType && params.signatureType !== 'NO_SIGNATURE_REQUIRED'
            ? { packageSpecialServices: { signatureOptionType: params.signatureType } }
            : {}),
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
    labelFormat: testMode ? 'png' : 'pdf',
  }
}

// ── Multi-piece Label Purchase (Vendor Returns) ──────────────────────────────

export interface FedExMultiPiecePackage {
  weight: { value: number; units: 'LB' | 'KG' }
  dimensions?: { length: number; width: number; height: number; units: 'IN' | 'CM' }
}
export interface FedExMultiPieceParams {
  shipFrom: FedExAddress & { personName: string; phone: string }
  shipTo: FedExAddress & { personName: string; phone: string }
  packages: FedExMultiPiecePackage[]
  serviceType: string
  shipDate?: string
  packagingType?: string
  signatureType?: FedExSignatureType
  reference?: string
}
export interface FedExMultiPieceResult {
  masterTrackingNumber: string
  pieces: { trackingNumber: string; labelData: string; labelFormat: string }[]
}

/** Create a single FedEx shipment with one or more packages (multi-piece / MPS),
 *  returning one label per package. Additive — does not touch createShipment. */
export async function createMultiPieceShipment(
  creds: FedExCredentials,
  params: FedExMultiPieceParams,
  testMode?: boolean,
): Promise<FedExMultiPieceResult> {
  if (!params.packages.length) throw new Error('At least one package is required.')
  const serviceType = params.serviceType === 'GROUND_HOME_DELIVERY' ? 'FEDEX_GROUND' : params.serviceType

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
        contact: { personName: params.shipFrom.personName, phoneNumber: params.shipFrom.phone },
      },
      recipients: [{
        address: {
          streetLines: params.shipTo.streetLines,
          city: params.shipTo.city,
          stateOrProvinceCode: params.shipTo.stateOrProvinceCode,
          postalCode: params.shipTo.postalCode,
          countryCode: params.shipTo.countryCode,
          residential: params.shipTo.residential,
        },
        contact: { personName: params.shipTo.personName, phoneNumber: params.shipTo.phone },
      }],
      ...(params.shipDate ? { shipDatestamp: params.shipDate } : {}),
      serviceType,
      packagingType: params.packagingType ?? 'YOUR_PACKAGING',
      pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
      shippingChargesPayment: {
        paymentType: 'SENDER',
        payor: { responsibleParty: { accountNumber: { value: creds.accountNumber } } },
      },
      totalPackageCount: params.packages.length,
      labelSpecification: {
        labelFormatType: 'COMMON2D',
        imageType: testMode ? 'PNG' : 'PDF',
        ...(testMode ? {} : { labelStockType: 'STOCK_4X6' }),
      },
      requestedPackageLineItems: params.packages.map((p, i) => ({
        sequenceNumber: i + 1,
        weight: { value: p.weight.value, units: p.weight.units },
        ...(p.dimensions ? { dimensions: {
          length: p.dimensions.length, width: p.dimensions.width, height: p.dimensions.height, units: p.dimensions.units,
        } } : {}),
        ...(params.signatureType && params.signatureType !== 'NO_SIGNATURE_REQUIRED'
          ? { packageSpecialServices: { signatureOptionType: params.signatureType } } : {}),
        ...(params.reference ? { customerReferences: [{ customerReferenceType: 'CUSTOMER_REFERENCE', value: params.reference }] } : {}),
      })),
    },
  }

  const data = await fedexFetch(creds, '/ship/v1/shipments', payload, testMode) as {
    output?: { transactionShipments?: Array<{
      masterTrackingNumber?: string
      pieceResponses?: Array<{ trackingNumber?: string; packageDocuments?: Array<{ encodedLabel?: string }> }>
    }> }
  }

  const shipment = data?.output?.transactionShipments?.[0]
  if (!shipment) throw new Error('FedEx shipment response missing transactionShipments')
  const pieceResponses = shipment.pieceResponses ?? []
  if (pieceResponses.length === 0) throw new Error('FedEx shipment response missing pieceResponses')

  const pieces = pieceResponses.map((pr) => {
    const label = pr.packageDocuments?.[0]?.encodedLabel
    if (!pr.trackingNumber || !label) throw new Error('A FedEx piece response was missing a tracking number or label.')
    return { trackingNumber: pr.trackingNumber, labelData: label, labelFormat: testMode ? 'png' : 'pdf' }
  })

  const masterTrackingNumber = shipment.masterTrackingNumber ?? pieces[0].trackingNumber
  return { masterTrackingNumber, pieces }
}

/** Rate a multi-piece shipment for a specific service without buying a label. */
export async function getMultiPieceRate(
  creds: FedExCredentials,
  params: FedExMultiPieceParams,
  testMode?: boolean,
): Promise<{ total: number; currency: string }> {
  const serviceType = params.serviceType === 'GROUND_HOME_DELIVERY' ? 'FEDEX_GROUND' : params.serviceType
  const payload = {
    accountNumber: { value: creds.accountNumber },
    requestedShipment: {
      shipper: { address: { city: params.shipFrom.city, stateOrProvinceCode: params.shipFrom.stateOrProvinceCode, postalCode: params.shipFrom.postalCode, countryCode: params.shipFrom.countryCode } },
      recipient: { address: { city: params.shipTo.city, stateOrProvinceCode: params.shipTo.stateOrProvinceCode, postalCode: params.shipTo.postalCode, countryCode: params.shipTo.countryCode, residential: params.shipTo.residential } },
      serviceType,
      pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
      packagingType: params.packagingType ?? 'YOUR_PACKAGING',
      rateRequestType: ['ACCOUNT', 'LIST'],
      requestedPackageLineItems: params.packages.map(p => ({ weight: p.weight, ...(p.dimensions ? { dimensions: p.dimensions } : {}) })),
    },
  }
  const data = await fedexFetch(creds, '/rate/v1/rates', payload, testMode) as {
    output?: { rateReplyDetails?: Array<{ serviceType?: string; ratedShipmentDetails?: Array<{ rateType?: string; totalNetCharge?: number; currency?: string }> }> }
  }
  const details = data?.output?.rateReplyDetails ?? []
  const detail = details.find(d => d.serviceType === serviceType) ?? details[0]
  const rsd = detail?.ratedShipmentDetails ?? []
  const chosen = rsd.find(r => r.rateType === 'ACCOUNT') ?? rsd.find(r => /NEGOTIATED/i.test(r.rateType ?? '')) ?? rsd[0]
  if (!chosen || chosen.totalNetCharge == null) throw new Error('FedEx returned no rate for this service.')
  return { total: chosen.totalNetCharge, currency: chosen.currency ?? 'USD' }
}

/** Cancel/void a FedEx shipment by its (master) tracking number. */
export async function cancelShipment(creds: FedExCredentials, trackingNumber: string, testMode?: boolean): Promise<void> {
  await fedexFetch(creds, '/ship/v1/shipments/cancel', {
    accountNumber: { value: creds.accountNumber },
    trackingNumber,
    deletionControl: 'DELETE_ALL_PACKAGES',
  }, testMode, 'PUT')
}
