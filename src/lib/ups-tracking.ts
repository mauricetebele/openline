/**
 * Carrier tracking — UPS API v2 (OAuth 2.0) + link fallbacks for all carriers.
 *
 * Credentials are loaded from the database (ups_credentials table) first,
 * with a fallback to environment variables UPS_CLIENT_ID / UPS_CLIENT_SECRET.
 *
 * Register for free at: https://developer.ups.com
 */
import axios from 'axios'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'

const UPS_AUTH_URL   = 'https://onlinetools.ups.com/security/v1/oauth/token'
const UPS_TRACK_URL  = 'https://onlinetools.ups.com/api/track/v1/details'
const UPS_SHIP_URL   = 'https://onlinetools.ups.com/api/shipments/v1/ship'
const UPS_RATE_URL   = 'https://onlinetools.ups.com/api/rating/v1/Rate'

const FEDEX_AUTH_URL  = 'https://apis.fedex.com/oauth/token'
const FEDEX_TRACK_URL = 'https://apis.fedex.com/track/v1/trackingnumbers'

// Per-credential token cache (keyed by credential ID or '_env' for env fallback)
const tokenCache = new Map<string, { token: string; expiresAt: number }>()
let cachedFedexToken: { token: string; expiresAt: number } | null = null

interface UPSCreds { id: string; clientId: string; clientSecret: string; accountNumber: string | null }

async function getUPSCredentials(): Promise<UPSCreds> {
  // Try DB first — load the default account
  try {
    const cred = await prisma.upsCredential.findFirst({
      where: { isActive: true, isDefault: true },
    })
    if (cred) {
      return {
        id:            cred.id,
        clientId:      decrypt(cred.clientIdEnc),
        clientSecret:  decrypt(cred.clientSecretEnc),
        accountNumber: cred.accountNumberEnc ? decrypt(cred.accountNumberEnc) : null,
      }
    }
    // Fallback: any active account if none marked default
    const any = await prisma.upsCredential.findFirst({ where: { isActive: true } })
    if (any) {
      return {
        id:            any.id,
        clientId:      decrypt(any.clientIdEnc),
        clientSecret:  decrypt(any.clientSecretEnc),
        accountNumber: any.accountNumberEnc ? decrypt(any.accountNumberEnc) : null,
      }
    }
  } catch { /* fall through to env */ }

  // Fallback to environment variables
  const clientId     = process.env.UPS_CLIENT_ID
  const clientSecret = process.env.UPS_CLIENT_SECRET
  if (clientId && clientSecret) {
    return { id: '_env', clientId, clientSecret, accountNumber: process.env.UPS_ACCOUNT_NUMBER ?? null }
  }

  throw new Error('UPS API credentials are not configured. Add them in Settings → UPS API.')
}

async function getUPSCredentialsById(credentialId: string): Promise<UPSCreds> {
  const cred = await prisma.upsCredential.findFirst({
    where: { id: credentialId, isActive: true },
  })
  if (!cred) throw new Error('UPS account not found or deactivated.')
  return {
    id:            cred.id,
    clientId:      decrypt(cred.clientIdEnc),
    clientSecret:  decrypt(cred.clientSecretEnc),
    accountNumber: cred.accountNumberEnc ? decrypt(cred.accountNumberEnc) : null,
  }
}

async function getUPSToken(creds?: UPSCreds): Promise<string> {
  const resolved = creds ?? await getUPSCredentials()
  const { id, clientId, clientSecret } = resolved

  if (!clientId || !clientSecret) {
    throw new Error('UPS API credentials are not configured. Add them in Settings → UPS API.')
  }

  const cached = tokenCache.get(id)
  if (cached && Date.now() < cached.expiresAt - 30_000) {
    return cached.token
  }

  tokenCache.delete(id)

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const { data } = await axios.post<{ access_token: string; expires_in: number }>(
    UPS_AUTH_URL,
    'grant_type=client_credentials',
    { headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } },
  )

  tokenCache.set(id, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1_000 })
  return data.access_token
}

// ─── FedEx Credentials & Token ────────────────────────────────────────────────

async function getFedExCredentials(): Promise<{ clientId: string; clientSecret: string; accountNumber: string | null }> {
  try {
    const cred = await prisma.fedexCredential.findFirst({ where: { isActive: true } })
    if (cred) {
      return {
        clientId:      decrypt(cred.clientIdEnc),
        clientSecret:  decrypt(cred.clientSecretEnc),
        accountNumber: cred.accountNumberEnc ? decrypt(cred.accountNumberEnc) : null,
      }
    }
  } catch { /* fall through */ }

  throw new Error('FedEx API credentials are not configured. Add them in Settings → FedEx API.')
}

async function getFedExToken(): Promise<string> {
  const { clientId, clientSecret } = await getFedExCredentials()

  if (cachedFedexToken && Date.now() < cachedFedexToken.expiresAt - 30_000) {
    return cachedFedexToken.token
  }

  cachedFedexToken = null

  const { data } = await axios.post<{ access_token: string; expires_in: number }>(
    FEDEX_AUTH_URL,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  )

  cachedFedexToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1_000 }
  return cachedFedexToken.token
}

export type Carrier = 'UPS' | 'USPS' | 'FEDEX' | 'AMZL' | 'UNKNOWN'

/** Detect likely carrier from tracking number format */
export function detectCarrier(tracking: string): Carrier {
  const t = tracking.trim().toUpperCase()

  // Amazon Logistics (TBA + digits)
  if (/^TBA\d{12,}$/.test(t)) return 'AMZL'

  // UPS: 1Z + 16 alphanumeric chars, or 9/18 digit numeric
  if (t.startsWith('1Z') && t.length === 18) return 'UPS'
  if (/^\d{9}$/.test(t) || /^\d{18}$/.test(t)) return 'UPS'

  // USPS: 9xxxx (22 digit) or 9xxxxx various long formats
  if (/^9[2-5]\d{18,}$/.test(t) || /^[0-9]{20,22}$/.test(t)) return 'USPS'

  // FedEx: 12, 15 or 20 digit
  if (/^\d{12}$/.test(t) || /^\d{15}$/.test(t)) return 'FEDEX'

  return 'UNKNOWN'
}

export function trackingUrl(tracking: string): string {
  const carrier = detectCarrier(tracking)
  if (carrier === 'UPS')   return `https://www.ups.com/track?tracknum=${tracking}`
  if (carrier === 'USPS')  return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${tracking}`
  if (carrier === 'FEDEX') return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`
  if (carrier === 'AMZL')  return `https://www.amazon.com/progress-tracker/package/ref=ppx_yo_dt_b_track_package?_encoding=UTF8&itemId=&orderId=${tracking}`
  return `https://www.google.com/search?q=${encodeURIComponent(tracking + ' tracking')}`
}

// ─── Rich tracking result ─────────────────────────────────────────────────────

export interface TrackingResult {
  status:            string
  deliveredAt:       Date | null  // set when package is delivered
  estimatedDelivery: Date | null  // set when package is in transit
}

// UPS date format is YYYYMMDD, time is HHMMSS (local time, no timezone)
function parseUpsDate(yyyymmdd: string | undefined, hhmmss?: string): Date | null {
  if (!yyyymmdd || yyyymmdd.length < 8) return null
  const y = parseInt(yyyymmdd.slice(0, 4), 10)
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1
  const d = parseInt(yyyymmdd.slice(6, 8), 10)
  if (hhmmss && hhmmss.length >= 6) {
    const h  = parseInt(hhmmss.slice(0, 2), 10)
    const mi = parseInt(hhmmss.slice(2, 4), 10)
    const s  = parseInt(hhmmss.slice(4, 6), 10)
    return new Date(y, m, d, h, mi, s)
  }
  return new Date(y, m, d)
}

/**
 * Fetch live carrier status for a UPS tracking number.
 * Returns a rich TrackingResult with actual delivery date or estimated delivery.
 * Throws a descriptive Error on any failure.
 */
export async function getCarrierStatus(tracking: string): Promise<TrackingResult> {
  const carrier = detectCarrier(tracking)

  if (carrier === 'AMZL') {
    throw new Error('Amazon Logistics (AMZL) tracking is not available via API. Use the Track link to check on Amazon.com.')
  }
  if (carrier === 'USPS') {
    throw new Error('USPS tracking status requires a USPS Web Tools account. Use the Track link to check on USPS.com.')
  }
  if (carrier === 'FEDEX') {
    return getFedExTrackingStatus(tracking)
  }
  if (carrier === 'UNKNOWN') {
    throw new Error(`Carrier could not be detected for tracking number "${tracking}". Use the Track link to look it up manually.`)
  }

  // UPS
  const token = await getUPSToken()

  let data: unknown
  try {
    const res = await axios.get(
      `${UPS_TRACK_URL}/${encodeURIComponent(tracking)}`,
      {
        params: { locale: 'en_US', returnSignature: 'false' },
        headers: {
          Authorization: `Bearer ${token}`,
          transId: `refund-auditor-${Date.now()}`,
          transactionSrc: 'RefundAuditor',
        },
      },
    )
    data = res.data
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { response?: { errors?: { message?: string }[] } } } })
      ?.response?.data?.response?.errors?.[0]?.message
    throw new Error(msg ?? 'UPS API request failed. Check your credentials and try again.')
  }

  interface UpsDeliveryDate { type?: string; date?: string }
  interface UpsDeliveryTime { type?: string; startTime?: string; endTime?: string }
  interface UpsPkg {
    currentStatus?: { code?: string; simplifiedTextDescription?: string; description?: string }
    deliveryDate?:  UpsDeliveryDate[]
    deliveryTime?:  UpsDeliveryTime
  }
  const pkg = (data as { trackResponse?: { shipment?: { package?: UpsPkg[] }[] } })
    ?.trackResponse?.shipment?.[0]?.package?.[0]

  const status = pkg?.currentStatus?.simplifiedTextDescription ?? pkg?.currentStatus?.description
  if (!status) throw new Error('UPS returned a response but no status was found for this tracking number.')

  const dates = pkg?.deliveryDate ?? []

  // DEL = actual delivery date (package delivered)
  const delEntry = dates.find(d => d.type === 'DEL')
  // SDD = scheduled, CMT = committed, RDD = rescheduled → all mean estimated delivery
  const estEntry = dates.find(d => ['SDD', 'CMT', 'RDD'].includes(d.type ?? ''))

  // Use the delivery time (end time) when available for the DEL entry
  const deliveryTimeStr = pkg?.deliveryTime?.type === 'DEL' ? pkg.deliveryTime.endTime : undefined

  const deliveredAt       = delEntry ? parseUpsDate(delEntry.date, deliveryTimeStr) : null
  const estimatedDelivery = estEntry ? parseUpsDate(estEntry.date)                  : null

  return { status, deliveredAt, estimatedDelivery }
}

// ─── FedEx Tracking ──────────────────────────────────────────────────────────

async function getFedExTrackingStatus(tracking: string): Promise<TrackingResult> {
  const token = await getFedExToken()

  let data: unknown
  try {
    const res = await axios.post(
      FEDEX_TRACK_URL,
      {
        includeDetailedScans: false,
        trackingInfo: [
          { trackingNumberInfo: { trackingNumber: tracking } },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-locale': 'en_US',
        },
      },
    )
    data = res.data
  } catch (e: unknown) {
    const axiosErr = e as { response?: { status?: number; data?: { errors?: { code?: string; message?: string }[] } } }
    const msg = axiosErr?.response?.data?.errors?.[0]?.message
    throw new Error(msg ?? 'FedEx API request failed. Check your credentials and try again.')
  }

  interface FedExDatetime { dateTime?: string; type?: string }
  interface FedExScanEvent { date?: string; derivedStatus?: string; eventDescription?: string }
  interface FedExTrackResult {
    latestStatusDetail?: { code?: string; derivedCode?: string; statusByLocale?: string; description?: string }
    dateAndTimes?: FedExDatetime[]
    scanEvents?: FedExScanEvent[]
  }

  const result = (data as {
    output?: {
      completeTrackResults?: {
        trackResults?: FedExTrackResult[]
      }[]
    }
  })?.output?.completeTrackResults?.[0]?.trackResults?.[0]

  const status = result?.latestStatusDetail?.statusByLocale
    ?? result?.latestStatusDetail?.description
    ?? result?.scanEvents?.[0]?.derivedStatus
  if (!status) throw new Error('FedEx returned a response but no status was found for this tracking number.')

  const dates = result?.dateAndTimes ?? []

  // ACTUAL_DELIVERY = delivered, ESTIMATED_DELIVERY = ETA
  const delEntry = dates.find(d => d.type === 'ACTUAL_DELIVERY')
  const estEntry = dates.find(d => d.type === 'ESTIMATED_DELIVERY')

  const deliveredAt       = delEntry?.dateTime ? new Date(delEntry.dateTime) : null
  const estimatedDelivery = estEntry?.dateTime ? new Date(estEntry.dateTime) : null

  return { status, deliveredAt, estimatedDelivery }
}

// ─── Return Label Generation ──────────────────────────────────────────────────

export const RETURN_ADDRESS = {
  name:    'PRIME MOBILITY FBM RETURNS',
  line1:   '20 MERIDIAN RD',
  line2:   'UNIT 2',
  city:    'EATONTOWN',
  state:   'NJ',
  postal:  '07724',
  country: 'US',
} as const

export const UPS_SERVICES = [
  { code: '03', label: 'UPS Ground' },
  { code: '02', label: 'UPS 2nd Day Air' },
  { code: '59', label: 'UPS 2nd Day Air A.M.' },
  { code: '13', label: 'UPS Next Day Air Saver' },
  { code: '01', label: 'UPS Next Day Air' },
  { code: '14', label: 'UPS Next Day Air Early' },
  { code: '12', label: 'UPS 3-Day Select' },
] as const

export interface ReturnLabelRequest {
  shipFromName:     string
  shipFromAddress1: string
  shipFromAddress2: string
  shipFromCity:     string
  shipFromState:    string
  shipFromPostal:   string
  shipFromCountry:  string
  serviceCode:      string
  weightValue:      number
  weightUnit:       'LBS' | 'OZS'
  length?:          number
  width?:           number
  height?:          number
  dimUnit?:         'IN' | 'CM'
  description?:     string
  referenceNumber?: string
}

export interface ChargeLineItem {
  description: string
  amount:      string
  currency:    string
}

export interface ReturnLabelResult {
  trackingNumber:   string
  shipmentId:       string   // UPS ShipmentIdentificationNumber — needed to void
  labelBase64:      string   // base64-encoded GIF image
  labelFormat:      'GIF'
  shipmentCost?:    string   // total charge from UPS (e.g. "12.50")
  currency?:        string   // e.g. "USD"
  chargeBreakdown?: ChargeLineItem[]  // itemised line items making up the total
}

/**
 * Generate a UPS return shipping label.
 * Shipper = our warehouse (billed to our account).
 * ShipFrom = buyer's address.
 * ShipTo = our warehouse.
 */
// Sanitise an address line for the UPS Shipping API:
// - Trim whitespace
// - Collapse repeated spaces
// - Strip characters UPS rejects (anything outside printable ASCII/Latin-1)
// - Truncate to 35 chars (UPS max for AddressLine)
function sanitizeAddressLine(raw: string): string {
  return raw
    .trim()
    .replace(/[^\x20-\x7E\u00C0-\u024F]/g, '')   // keep printable ASCII + Latin accents
    .replace(/\s{2,}/g, ' ')
    .slice(0, 35)
}

export async function generateReturnLabel(req: ReturnLabelRequest, upsCredentialId?: string): Promise<ReturnLabelResult> {
  const creds = upsCredentialId ? await getUPSCredentialsById(upsCredentialId) : await getUPSCredentials()
  const { accountNumber } = creds
  if (!accountNumber) {
    throw new Error('UPS Account Number is not configured. Add it in Settings → UPS API.')
  }

  const token = await getUPSToken(creds)

  const line1 = sanitizeAddressLine(req.shipFromAddress1)
  if (!line1) {
    throw new Error('Ship-from address line 1 is empty after cleanup. Please enter a valid street address.')
  }
  const addressLines = [line1]
  const line2 = req.shipFromAddress2?.trim() ? sanitizeAddressLine(req.shipFromAddress2) : ''
  if (line2) addressLines.push(line2)

  const dimUnitDesc   = (req.dimUnit ?? 'IN') === 'CM' ? 'Centimeters' : 'Inches'
  const weightUnitDesc = req.weightUnit === 'OZS' ? 'Ounces' : 'Pounds'

  const body = {
    ShipmentRequest: {
      Request: {
        RequestOption: 'nonvalidate',
        TransactionReference: { CustomerContext: req.referenceNumber ?? 'return-label' },
      },
      Shipment: {
        Description: req.description ?? 'Return Shipment',
        Shipper: {
          Name:          sanitizeAddressLine(req.shipFromName) || 'Customer',
          ShipperNumber: accountNumber,
          Address: {
            AddressLine:       addressLines,
            City:              sanitizeAddressLine(req.shipFromCity),
            StateProvinceCode: req.shipFromState?.trim().slice(0, 2),
            PostalCode:        req.shipFromPostal?.trim().replace(/[^0-9-]/g, '').slice(0, 10),
            CountryCode:       req.shipFromCountry?.trim() || 'US',
          },
        },
        ShipTo: {
          Name: RETURN_ADDRESS.name,
          Address: {
            AddressLine:       [RETURN_ADDRESS.line1, RETURN_ADDRESS.line2],
            City:              RETURN_ADDRESS.city,
            StateProvinceCode: RETURN_ADDRESS.state,
            PostalCode:        RETURN_ADDRESS.postal,
            CountryCode:       RETURN_ADDRESS.country,
          },
        },
        Service: {
          Code:        req.serviceCode,
          Description: UPS_SERVICES.find(s => s.code === req.serviceCode)?.label ?? '',
        },
        PaymentInformation: {
          ShipmentCharge: {
            Type:        '01',
            BillShipper: { AccountNumber: accountNumber },
          },
        },
        ShipmentRatingOptions: { NegotiatedRatesIndicator: 'X' },
        Package: {
          Description: req.description ?? 'Return Shipment',
          Packaging: {
            Code:        '02',
            Description: 'Customer Supplied Package',
          },
          ...(req.length && req.width && req.height ? {
            Dimensions: {
              UnitOfMeasurement: { Code: req.dimUnit ?? 'IN', Description: dimUnitDesc },
              Length: String(req.length),
              Width:  String(req.width),
              Height: String(req.height),
            },
          } : {}),
          PackageWeight: {
            UnitOfMeasurement: { Code: req.weightUnit, Description: weightUnitDesc },
            Weight: String(req.weightValue),
          },
          ...(req.referenceNumber ? {
            ReferenceNumber: { Code: 'IK', Value: req.referenceNumber },
          } : {}),
        },
      },
      LabelSpecification: {
        LabelImageFormat: { Code: 'GIF', Description: 'GIF' },
        HTTPUserAgent:    'Mozilla/4.5',
      },
    },
  }

  let data: unknown
  try {
    const res = await axios.post(UPS_SHIP_URL, body, {
      headers: {
        Authorization:    `Bearer ${token}`,
        transId:          `return-label-${Date.now()}`,
        transactionSrc:   'RefundAuditor',
        'Content-Type':   'application/json',
      },
    })
    data = res.data
  } catch (e: unknown) {
    const axiosErr = e as { response?: { status?: number; data?: unknown } }
    const resData  = axiosErr?.response?.data as Record<string, unknown> | undefined

    console.error('[UPS Ship] error response:', JSON.stringify(resData, null, 2))

    // Try nested UPS error format: response.errors[].message
    const errors = (resData?.response as { errors?: { code?: string; message?: string }[] })?.errors ?? []
    const firstErr = errors[0]

    if (firstErr?.message) {
      const code = firstErr.code ? ` [${firstErr.code}]` : ''
      throw new Error(`UPS${code}: ${firstErr.message}`)
    }

    throw new Error(`UPS label generation failed (HTTP ${axiosErr?.response?.status ?? 'unknown'}). Check server logs for details.`)
  }

  interface UpsMonetary { MonetaryValue?: string; CurrencyCode?: string }
  interface UpsItemizedCharge extends UpsMonetary { Code?: string; Description?: string }

  const results = (data as {
    ShipmentResponse?: {
      ShipmentResults?: {
        ShipmentIdentificationNumber?: string
        ShipmentCharges?: {
          TransportationCharges?:  UpsMonetary
          ServiceOptionsCharges?:  UpsMonetary
          TotalCharges?:           UpsMonetary
        }
        NegotiatedRateCharges?: {
          ItemizedCharges?: UpsItemizedCharge | UpsItemizedCharge[]
          TotalCharge?:     UpsMonetary
        }
        PackageResults?: { TrackingNumber?: string; ShippingLabel?: { GraphicImage?: string } } |
                         { TrackingNumber?: string; ShippingLabel?: { GraphicImage?: string } }[]
      }
    }
  })?.ShipmentResponse?.ShipmentResults

  const pkg = Array.isArray(results?.PackageResults) ? results.PackageResults[0] : results?.PackageResults
  const trackingNumber = pkg?.TrackingNumber ?? results?.ShipmentIdentificationNumber ?? ''
  const shipmentId     = results?.ShipmentIdentificationNumber ?? trackingNumber
  const labelBase64    = pkg?.ShippingLabel?.GraphicImage ?? ''

  if (!labelBase64) throw new Error('UPS returned a response but no label image was found.')

  // Prefer negotiated rates (account-level pricing) over published rates
  const chargeBlock  = results?.NegotiatedRateCharges?.TotalCharge ?? results?.ShipmentCharges?.TotalCharges
  const shipmentCost = chargeBlock?.MonetaryValue
  const currency     = chargeBlock?.CurrencyCode ?? 'USD'

  // Build itemised charge breakdown ─────────────────────────────────────────
  const breakdown: ChargeLineItem[] = []

  const addLine = (description: string, m?: UpsMonetary) => {
    if (m?.MonetaryValue && parseFloat(m.MonetaryValue) > 0)
      breakdown.push({ description, amount: m.MonetaryValue, currency: m.CurrencyCode ?? currency })
  }

  addLine('Transportation', results?.ShipmentCharges?.TransportationCharges)
  addLine('Service Options', results?.ShipmentCharges?.ServiceOptionsCharges)

  // Itemized surcharges from negotiated rate block (fuel, DAS, residential, etc.)
  const rawItems = results?.NegotiatedRateCharges?.ItemizedCharges
  const items: UpsItemizedCharge[] = rawItems
    ? (Array.isArray(rawItems) ? rawItems : [rawItems])
    : []
  for (const item of items) {
    const label = item.Description ?? (item.Code ? `Surcharge (${item.Code})` : 'Surcharge')
    addLine(label, item)
  }

  return {
    trackingNumber, shipmentId, labelBase64, labelFormat: 'GIF',
    shipmentCost, currency,
    chargeBreakdown: breakdown.length > 0 ? breakdown : undefined,
  }
}

// ─── Outbound Label Generation (warehouse → customer) ────────────────────────

/**
 * Generate a UPS outbound shipping label.
 * Shipper = our warehouse (billed to our account).
 * ShipTo = customer address.
 */
export async function generateOutboundLabel(req: ReturnLabelRequest, upsCredentialId?: string): Promise<ReturnLabelResult> {
  const creds = upsCredentialId ? await getUPSCredentialsById(upsCredentialId) : await getUPSCredentials()
  const { accountNumber } = creds
  if (!accountNumber) {
    throw new Error('UPS Account Number is not configured. Add it in Settings → UPS API.')
  }

  const token = await getUPSToken(creds)

  const line1 = sanitizeAddressLine(req.shipFromAddress1)
  if (!line1) {
    throw new Error('Ship-to address line 1 is empty after cleanup. Please enter a valid street address.')
  }
  const customerAddressLines = [line1]
  const line2 = req.shipFromAddress2?.trim() ? sanitizeAddressLine(req.shipFromAddress2) : ''
  if (line2) customerAddressLines.push(line2)

  const dimUnitDesc   = (req.dimUnit ?? 'IN') === 'CM' ? 'Centimeters' : 'Inches'
  const weightUnitDesc = req.weightUnit === 'OZS' ? 'Ounces' : 'Pounds'

  const body = {
    ShipmentRequest: {
      Request: {
        RequestOption: 'nonvalidate',
        TransactionReference: { CustomerContext: req.referenceNumber ?? 'outbound-label' },
      },
      Shipment: {
        Description: req.description ?? 'Outbound Shipment',
        Shipper: {
          Name:          RETURN_ADDRESS.name,
          ShipperNumber: accountNumber,
          Address: {
            AddressLine:       [RETURN_ADDRESS.line1, RETURN_ADDRESS.line2],
            City:              RETURN_ADDRESS.city,
            StateProvinceCode: RETURN_ADDRESS.state,
            PostalCode:        RETURN_ADDRESS.postal,
            CountryCode:       RETURN_ADDRESS.country,
          },
        },
        ShipTo: {
          Name: sanitizeAddressLine(req.shipFromName) || 'Customer',
          Address: {
            AddressLine:       customerAddressLines,
            City:              sanitizeAddressLine(req.shipFromCity),
            StateProvinceCode: req.shipFromState?.trim().slice(0, 2),
            PostalCode:        req.shipFromPostal?.trim().replace(/[^0-9-]/g, '').slice(0, 10),
            CountryCode:       req.shipFromCountry?.trim() || 'US',
          },
        },
        Service: {
          Code:        req.serviceCode,
          Description: UPS_SERVICES.find(s => s.code === req.serviceCode)?.label ?? '',
        },
        PaymentInformation: {
          ShipmentCharge: {
            Type:        '01',
            BillShipper: { AccountNumber: accountNumber },
          },
        },
        ShipmentRatingOptions: { NegotiatedRatesIndicator: 'X' },
        Package: {
          Description: req.description ?? 'Outbound Shipment',
          Packaging: {
            Code:        '02',
            Description: 'Customer Supplied Package',
          },
          ...(req.length && req.width && req.height ? {
            Dimensions: {
              UnitOfMeasurement: { Code: req.dimUnit ?? 'IN', Description: dimUnitDesc },
              Length: String(req.length),
              Width:  String(req.width),
              Height: String(req.height),
            },
          } : {}),
          PackageWeight: {
            UnitOfMeasurement: { Code: req.weightUnit, Description: weightUnitDesc },
            Weight: String(req.weightValue),
          },
          ...(req.referenceNumber ? {
            ReferenceNumber: { Code: 'IK', Value: req.referenceNumber },
          } : {}),
        },
      },
      LabelSpecification: {
        LabelImageFormat: { Code: 'GIF', Description: 'GIF' },
        HTTPUserAgent:    'Mozilla/4.5',
      },
    },
  }

  let data: unknown
  try {
    const res = await axios.post(UPS_SHIP_URL, body, {
      headers: {
        Authorization:    `Bearer ${token}`,
        transId:          `outbound-label-${Date.now()}`,
        transactionSrc:   'RefundAuditor',
        'Content-Type':   'application/json',
      },
    })
    data = res.data
  } catch (e: unknown) {
    const axiosErr = e as { response?: { status?: number; data?: unknown } }
    const resData  = axiosErr?.response?.data as Record<string, unknown> | undefined

    console.error('[UPS Ship Outbound] error response:', JSON.stringify(resData, null, 2))

    const errors = (resData?.response as { errors?: { code?: string; message?: string }[] })?.errors ?? []
    const firstErr = errors[0]

    if (firstErr?.message) {
      const code = firstErr.code ? ` [${firstErr.code}]` : ''
      throw new Error(`UPS${code}: ${firstErr.message}`)
    }

    throw new Error(`UPS label generation failed (HTTP ${axiosErr?.response?.status ?? 'unknown'}). Check server logs for details.`)
  }

  interface UpsMonetary { MonetaryValue?: string; CurrencyCode?: string }
  interface UpsItemizedCharge extends UpsMonetary { Code?: string; Description?: string }

  const results = (data as {
    ShipmentResponse?: {
      ShipmentResults?: {
        ShipmentIdentificationNumber?: string
        ShipmentCharges?: {
          TransportationCharges?:  UpsMonetary
          ServiceOptionsCharges?:  UpsMonetary
          TotalCharges?:           UpsMonetary
        }
        NegotiatedRateCharges?: {
          ItemizedCharges?: UpsItemizedCharge | UpsItemizedCharge[]
          TotalCharge?:     UpsMonetary
        }
        PackageResults?: { TrackingNumber?: string; ShippingLabel?: { GraphicImage?: string } } |
                         { TrackingNumber?: string; ShippingLabel?: { GraphicImage?: string } }[]
      }
    }
  })?.ShipmentResponse?.ShipmentResults

  const pkg = Array.isArray(results?.PackageResults) ? results.PackageResults[0] : results?.PackageResults
  const trackingNumber = pkg?.TrackingNumber ?? results?.ShipmentIdentificationNumber ?? ''
  const shipmentId     = results?.ShipmentIdentificationNumber ?? trackingNumber
  const labelBase64    = pkg?.ShippingLabel?.GraphicImage ?? ''

  if (!labelBase64) throw new Error('UPS returned a response but no label image was found.')

  const chargeBlock  = results?.NegotiatedRateCharges?.TotalCharge ?? results?.ShipmentCharges?.TotalCharges
  const shipmentCost = chargeBlock?.MonetaryValue
  const currency     = chargeBlock?.CurrencyCode ?? 'USD'

  const breakdown: ChargeLineItem[] = []
  const addLine = (description: string, m?: UpsMonetary) => {
    if (m?.MonetaryValue && parseFloat(m.MonetaryValue) > 0)
      breakdown.push({ description, amount: m.MonetaryValue, currency: m.CurrencyCode ?? currency })
  }

  addLine('Transportation', results?.ShipmentCharges?.TransportationCharges)
  addLine('Service Options', results?.ShipmentCharges?.ServiceOptionsCharges)

  const rawItems = results?.NegotiatedRateCharges?.ItemizedCharges
  const items: UpsItemizedCharge[] = rawItems
    ? (Array.isArray(rawItems) ? rawItems : [rawItems])
    : []
  for (const item of items) {
    const label = item.Description ?? (item.Code ? `Surcharge (${item.Code})` : 'Surcharge')
    addLine(label, item)
  }

  return {
    trackingNumber, shipmentId, labelBase64, labelFormat: 'GIF',
    shipmentCost, currency,
    chargeBreakdown: breakdown.length > 0 ? breakdown : undefined,
  }
}

// ─── Outbound Rate Quote ──────────────────────────────────────────────────────

/**
 * Fetch a UPS rate quote for an outbound shipment (warehouse → customer).
 */
export async function getOutboundRateQuote(req: ReturnLabelRequest, upsCredentialId?: string): Promise<RateQuoteResult> {
  const creds = upsCredentialId ? await getUPSCredentialsById(upsCredentialId) : await getUPSCredentials()
  const { accountNumber } = creds
  if (!accountNumber) {
    throw new Error('UPS Account Number is not configured. Add it in Settings → UPS API.')
  }

  const token = await getUPSToken(creds)

  const custLine1 = sanitizeAddressLine(req.shipFromAddress1)
  const customerAddressLines = [custLine1]
  const custLine2 = req.shipFromAddress2?.trim() ? sanitizeAddressLine(req.shipFromAddress2) : ''
  if (custLine2) customerAddressLines.push(custLine2)

  const body = {
    RateRequest: {
      Request: {
        RequestOption: 'Rate',
        TransactionReference: { CustomerContext: 'outbound-rate-quote' },
      },
      Shipment: {
        Shipper: {
          Name:          RETURN_ADDRESS.name,
          ShipperNumber: accountNumber,
          Address: {
            AddressLine:       [RETURN_ADDRESS.line1, RETURN_ADDRESS.line2],
            City:              RETURN_ADDRESS.city,
            StateProvinceCode: RETURN_ADDRESS.state,
            PostalCode:        RETURN_ADDRESS.postal,
            CountryCode:       RETURN_ADDRESS.country,
          },
        },
        ShipTo: {
          Name: sanitizeAddressLine(req.shipFromName) || 'Customer',
          Address: {
            AddressLine:       customerAddressLines,
            City:              sanitizeAddressLine(req.shipFromCity),
            StateProvinceCode: req.shipFromState?.trim().slice(0, 2),
            PostalCode:        req.shipFromPostal?.trim().replace(/[^0-9-]/g, '').slice(0, 10),
            CountryCode:       req.shipFromCountry?.trim() || 'US',
          },
        },
        Service: { Code: req.serviceCode },
        Package: [
          {
            PackagingType: { Code: '02' },
            ...(req.length && req.width && req.height ? {
              Dimensions: {
                UnitOfMeasurement: { Code: req.dimUnit ?? 'IN' },
                Length: String(req.length),
                Width:  String(req.width),
                Height: String(req.height),
              },
            } : {}),
            PackageWeight: {
              UnitOfMeasurement: { Code: req.weightUnit },
              Weight: String(req.weightValue),
            },
          },
        ],
        ShipmentRatingOptions: { NegotiatedRatesIndicator: 'X' },
      },
    },
  }

  let data: unknown
  try {
    const res = await axios.post(UPS_RATE_URL, body, {
      headers: {
        Authorization:  `Bearer ${token}`,
        transId:        `outbound-rate-${Date.now()}`,
        transactionSrc: 'RefundAuditor',
        'Content-Type': 'application/json',
      },
    })
    data = res.data
  } catch (e: unknown) {
    const axiosErr  = e as { response?: { status?: number; data?: { response?: { errors?: { code?: string; message?: string }[] } } } }
    const upsErrors = axiosErr?.response?.data?.response?.errors ?? []
    const firstMsg  = upsErrors[0]?.message ?? ''
    const firstCode = upsErrors[0]?.code ?? ''

    if (firstCode === '250003' || /invalid auth/i.test(firstMsg) || axiosErr?.response?.status === 401) {
      throw new Error(
        'UPS returned "Invalid Authentication Information". ' +
        'Your UPS developer app likely does not have the Rating API product enabled. ' +
        'Go to developer.ups.com → My Apps → edit your app → add the "Rating" product, then re-save your credentials in Settings → UPS API.'
      )
    }

    throw new Error(firstMsg || 'UPS Rating API request failed.')
  }

  const rated = (data as {
    RateResponse?: {
      RatedShipment?: {
        TotalCharges?:          { MonetaryValue?: string; CurrencyCode?: string }
        NegotiatedRateCharges?: { TotalCharge?: { MonetaryValue?: string; CurrencyCode?: string } }
      }
    }
  })?.RateResponse?.RatedShipment

  const publishedRate  = rated?.TotalCharges?.MonetaryValue ?? ''
  const currency       = rated?.TotalCharges?.CurrencyCode ?? 'USD'
  const negotiatedRate = rated?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ?? null

  if (!publishedRate) throw new Error('UPS returned a rate response but no charge was found.')

  const serviceLabel = UPS_SERVICES.find(s => s.code === req.serviceCode)?.label ?? req.serviceCode

  return { publishedRate, negotiatedRate, currency, serviceCode: req.serviceCode, serviceLabel }
}

// ─── Rate Quote ───────────────────────────────────────────────────────────────

export interface RateQuoteResult {
  publishedRate:  string   // standard published rate
  negotiatedRate: string | null  // account-level rate (if available)
  currency:       string
  serviceCode:    string
  serviceLabel:   string
}

/**
 * Fetch a UPS rate quote for a return shipment without purchasing a label.
 * Uses the same address/package parameters as generateReturnLabel.
 */
export async function getRateQuote(req: ReturnLabelRequest, upsCredentialId?: string): Promise<RateQuoteResult> {
  const creds = upsCredentialId ? await getUPSCredentialsById(upsCredentialId) : await getUPSCredentials()
  const { accountNumber } = creds
  if (!accountNumber) {
    throw new Error('UPS Account Number is not configured. Add it in Settings → UPS API.')
  }

  const token = await getUPSToken(creds)

  const rateLine1 = sanitizeAddressLine(req.shipFromAddress1)
  const addressLines = [rateLine1]
  const rateLine2 = req.shipFromAddress2?.trim() ? sanitizeAddressLine(req.shipFromAddress2) : ''
  if (rateLine2) addressLines.push(rateLine2)

  const body = {
    RateRequest: {
      Request: {
        RequestOption: 'Rate',
        TransactionReference: { CustomerContext: 'rate-quote' },
      },
      Shipment: {
        Shipper: {
          Name:          sanitizeAddressLine(req.shipFromName) || 'Customer',
          ShipperNumber: accountNumber,
          Address: {
            AddressLine:       addressLines,
            City:              sanitizeAddressLine(req.shipFromCity),
            StateProvinceCode: req.shipFromState?.trim().slice(0, 2),
            PostalCode:        req.shipFromPostal?.trim().replace(/[^0-9-]/g, '').slice(0, 10),
            CountryCode:       req.shipFromCountry?.trim() || 'US',
          },
        },
        ShipTo: {
          Name: RETURN_ADDRESS.name,
          Address: {
            AddressLine:       [RETURN_ADDRESS.line1, RETURN_ADDRESS.line2],
            City:              RETURN_ADDRESS.city,
            StateProvinceCode: RETURN_ADDRESS.state,
            PostalCode:        RETURN_ADDRESS.postal,
            CountryCode:       RETURN_ADDRESS.country,
          },
        },
        Service: { Code: req.serviceCode },
        Package: [
          {
            PackagingType: { Code: '02' },
            ...(req.length && req.width && req.height ? {
              Dimensions: {
                UnitOfMeasurement: { Code: req.dimUnit ?? 'IN' },
                Length: String(req.length),
                Width:  String(req.width),
                Height: String(req.height),
              },
            } : {}),
            PackageWeight: {
              UnitOfMeasurement: { Code: req.weightUnit },
              Weight: String(req.weightValue),
            },
          },
        ],
        // Request negotiated rates — included only when account supports it;
        // UPS silently ignores this if negotiated rates aren't enabled.
        ShipmentRatingOptions: { NegotiatedRatesIndicator: 'X' },
      },
    },
  }

  let data: unknown
  try {
    const res = await axios.post(UPS_RATE_URL, body, {
      headers: {
        Authorization:  `Bearer ${token}`,
        transId:        `rate-quote-${Date.now()}`,
        transactionSrc: 'RefundAuditor',
        'Content-Type': 'application/json',
      },
    })
    data = res.data
  } catch (e: unknown) {
    const axiosErr  = e as { response?: { status?: number; data?: { response?: { errors?: { code?: string; message?: string }[] } } } }
    const upsErrors = axiosErr?.response?.data?.response?.errors ?? []
    const firstMsg  = upsErrors[0]?.message ?? ''
    const firstCode = upsErrors[0]?.code ?? ''

    // 250003 = invalid auth / app not subscribed to this API product
    if (firstCode === '250003' || /invalid auth/i.test(firstMsg) || axiosErr?.response?.status === 401) {
      throw new Error(
        'UPS returned "Invalid Authentication Information". ' +
        'Your UPS developer app likely does not have the Rating API product enabled. ' +
        'Go to developer.ups.com → My Apps → edit your app → add the "Rating" product, then re-save your credentials in Settings → UPS API.'
      )
    }

    throw new Error(firstMsg || 'UPS Rating API request failed.')
  }

  const rated = (data as {
    RateResponse?: {
      RatedShipment?: {
        TotalCharges?:          { MonetaryValue?: string; CurrencyCode?: string }
        NegotiatedRateCharges?: { TotalCharge?: { MonetaryValue?: string; CurrencyCode?: string } }
      }
    }
  })?.RateResponse?.RatedShipment

  const publishedRate  = rated?.TotalCharges?.MonetaryValue ?? ''
  const currency       = rated?.TotalCharges?.CurrencyCode ?? 'USD'
  const negotiatedRate = rated?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ?? null

  if (!publishedRate) throw new Error('UPS returned a rate response but no charge was found.')

  const serviceLabel = UPS_SERVICES.find(s => s.code === req.serviceCode)?.label ?? req.serviceCode

  return { publishedRate, negotiatedRate, currency, serviceCode: req.serviceCode, serviceLabel }
}

// ─── Void a Return Label ──────────────────────────────────────────────────────

const UPS_VOID_URL = 'https://onlinetools.ups.com/api/shipments/v1/void/cancel'

/**
 * Void a UPS shipment by its ShipmentIdentificationNumber.
 * UPS allows voiding within a short window before the carrier picks up.
 * Throws a descriptive error if the shipment cannot be voided.
 */
export async function voidReturnLabel(shipmentId: string, upsCredentialId?: string): Promise<void> {
  const creds = upsCredentialId ? await getUPSCredentialsById(upsCredentialId) : await getUPSCredentials()
  const token = await getUPSToken(creds)

  try {
    await axios.delete(`${UPS_VOID_URL}/${encodeURIComponent(shipmentId)}`, {
      headers: {
        Authorization:  `Bearer ${token}`,
        transId:        `void-${Date.now()}`,
        transactionSrc: 'RefundAuditor',
      },
    })
  } catch (e: unknown) {
    const axiosErr  = e as { response?: { status?: number; data?: unknown } }
    const resData   = axiosErr?.response?.data as Record<string, unknown> | undefined
    const errors    = (resData?.response as { errors?: { code?: string; message?: string }[] })?.errors ?? []
    const firstErr  = errors[0]
    if (firstErr?.message) {
      const code = firstErr.code ? ` [${firstErr.code}]` : ''
      throw new Error(`UPS${code}: ${firstErr.message}`)
    }
    throw new Error(`UPS void failed (HTTP ${axiosErr?.response?.status ?? 'unknown'}).`)
  }
}
