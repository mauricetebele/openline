/**
 * Manual "Create Shipping Labels" engine — rates + buys multi-piece labels via
 * three paths and logs each piece to the ReturnLabel table (labelType MANUAL_*):
 *   - ups   : UPS Direct (our UPS account, true multi-piece)
 *   - fedex : FedEx Direct (our FedEx account, true multi-piece)
 *   - ss    : UPS billed through ShipStation ("walleted") — one label per box
 *
 * The logged tracking numbers feed orphan reconciliation, so these are never
 * flagged as orphaned ShipStation labels.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import {
  generateUpsMultiPieceLabels, getUpsMultiPieceRate, UPS_SERVICES,
  type MultiPieceAddress, type MultiPiecePackage,
} from '@/lib/ups-tracking'
import { loadFedExCredentials, createMultiPieceShipment, getMultiPieceRate } from '@/lib/fedex/client'
import { ShipStationClient, type SSAddress } from '@/lib/shipstation/client'

export type LabelPath = 'ups' | 'fedex' | 'ss'

export interface LabelAddress {
  name: string; company?: string; address1: string; address2?: string
  city: string; state: string; postal: string; country?: string; phone?: string
}
export interface LabelPackage {
  weightValue: number; weightUnit: 'LBS' | 'OZS'
  length?: number; width?: number; height?: number; dimUnit?: 'IN' | 'CM'
}
export interface ManualLabelInput {
  path: LabelPath
  shipFrom: LabelAddress
  shipTo: LabelAddress
  packages: LabelPackage[]
  serviceCode: string
  confirmation?: 'none' | 'delivery' | 'signature' | 'adult_signature'
  referenceNumber?: string
  upsCredentialId?: string
}
export interface LabelPiece { trackingNumber: string; labelBase64: string; labelFormat: string }
export interface CreatedShipment {
  path: LabelPath; carrier: string; serviceLabel: string
  masterTracking: string; shipmentCost: number | null; currency: string; pieces: LabelPiece[]
}

const CARRIER_LABEL: Record<LabelPath, string> = { ups: 'UPS', fedex: 'FedEx', ss: 'UPS (ShipStation)' }
const SS_CARRIER_CODE = 'ups_walleted'

const FEDEX_SERVICE_NAMES: Record<string, string> = {
  FEDEX_GROUND: 'FedEx Ground', GROUND_HOME_DELIVERY: 'FedEx Home Delivery',
  FEDEX_2_DAY: 'FedEx 2Day', FEDEX_2_DAY_AM: 'FedEx 2Day A.M.', FEDEX_EXPRESS_SAVER: 'FedEx Express Saver',
  STANDARD_OVERNIGHT: 'FedEx Standard Overnight', PRIORITY_OVERNIGHT: 'FedEx Priority Overnight',
  FIRST_OVERNIGHT: 'FedEx First Overnight',
}
const SS_UPS_SERVICE_NAMES: Record<string, string> = {
  ups_ground: 'UPS Ground', ups_3_day_select: 'UPS 3 Day Select', ups_2nd_day_air: 'UPS 2nd Day Air',
  ups_2nd_day_air_am: 'UPS 2nd Day Air A.M.', ups_next_day_air_saver: 'UPS Next Day Air Saver',
  ups_next_day_air: 'UPS Next Day Air', ups_next_day_air_early_am: 'UPS Next Day Air Early',
}
export function serviceLabelFor(path: LabelPath, code: string): string {
  if (path === 'ups') return UPS_SERVICES.find(s => s.code === code)?.label ?? code
  if (path === 'fedex') return FEDEX_SERVICE_NAMES[code] ?? code
  return SS_UPS_SERVICE_NAMES[code] ?? code
}

const digits = (s?: string) => (s ?? '').replace(/[^0-9]/g, '') || '0000000000'
const toLb = (p: LabelPackage) => (p.weightUnit === 'OZS' ? p.weightValue / 16 : p.weightValue)

function toMPAddress(a: LabelAddress): MultiPieceAddress {
  return { name: a.name, company: a.company || undefined, address1: a.address1, address2: a.address2 || undefined,
    city: a.city, state: a.state, postal: a.postal, country: a.country || 'US', phone: a.phone || undefined }
}
function toSSAddress(a: LabelAddress): SSAddress {
  return { name: a.name, company: a.company || null, street1: a.address1, street2: a.address2 || null,
    city: a.city, state: a.state, postalCode: a.postal, country: a.country || 'US', phone: a.phone || null }
}
function fedexAddr(a: LabelAddress) {
  return { streetLines: [a.address1, a.address2].filter(Boolean) as string[], city: a.city,
    stateOrProvinceCode: a.state.slice(0, 2), postalCode: a.postal, countryCode: a.country || 'US',
    personName: a.name, phone: digits(a.phone), ...(a.company ? { company: a.company } : {}) }
}
function upsPackages(pkgs: LabelPackage[]): MultiPiecePackage[] {
  return pkgs.map(p => ({ weightValue: p.weightValue, weightUnit: p.weightUnit === 'OZS' ? 'OZS' : 'LBS',
    length: p.length, width: p.width, height: p.height, dimUnit: p.dimUnit === 'CM' ? 'CM' : 'IN' }))
}
function fedexPackages(pkgs: LabelPackage[]) {
  return pkgs.map(p => ({ weight: { value: toLb(p), units: 'LB' as const },
    ...(p.length && p.width && p.height ? { dimensions: { length: p.length, width: p.width, height: p.height, units: (p.dimUnit === 'CM' ? 'CM' : 'IN') as 'CM' | 'IN' } } : {}) }))
}
const ssWeight = (p: LabelPackage) => ({ value: p.weightValue, units: (p.weightUnit === 'OZS' ? 'ounces' : 'pounds') as 'ounces' | 'pounds' })
const ssDims = (p: LabelPackage) =>
  p.length && p.width && p.height ? { units: 'inches' as const, length: p.length, width: p.width, height: p.height } : undefined

async function ssClient(): Promise<ShipStationClient> {
  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true }, orderBy: { createdAt: 'asc' },
    select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
  })
  if (!account) throw new Error('No active ShipStation account connected')
  return new ShipStationClient(
    decrypt(account.apiKeyEnc),
    account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '',
    account.v2ApiKeyEnc ? decrypt(account.v2ApiKeyEnc) : null,
  )
}

const FEDEX_SIG = { signature: 'DIRECT', adult_signature: 'ADULT', delivery: 'INDIRECT' } as const

// ─── Rate ────────────────────────────────────────────────────────────────────
export async function rateManualShipment(input: ManualLabelInput): Promise<{ total: number; currency: string }> {
  const shipFrom = toMPAddress(input.shipFrom)
  const shipTo = toMPAddress(input.shipTo)

  if (input.path === 'ups') {
    return getUpsMultiPieceRate({ shipFrom, shipTo, serviceCode: input.serviceCode, packages: upsPackages(input.packages) }, input.upsCredentialId)
  }
  if (input.path === 'fedex') {
    const creds = await loadFedExCredentials()
    if (!creds) throw new Error('FedEx credentials not configured — add them in Settings → FedEx.')
    return getMultiPieceRate(creds, { shipFrom: fedexAddr(input.shipFrom), shipTo: fedexAddr(input.shipTo), packages: fedexPackages(input.packages), serviceType: input.serviceCode })
  }
  // ShipStation UPS — rate each box, sum the selected service.
  const client = await ssClient()
  let total = 0
  for (const p of input.packages) {
    const rates = await client.getRates({
      carrierCode: SS_CARRIER_CODE, serviceCode: input.serviceCode,
      fromPostalCode: input.shipFrom.postal, fromCity: input.shipFrom.city, fromState: input.shipFrom.state,
      toPostalCode: input.shipTo.postal, toCity: input.shipTo.city, toState: input.shipTo.state, toCountry: input.shipTo.country || 'US',
      weight: ssWeight(p), dimensions: ssDims(p), confirmation: input.confirmation ?? 'none',
    })
    const match = rates.find(r => r.serviceCode === input.serviceCode) ?? rates[0]
    if (!match) throw new Error('ShipStation returned no UPS rate for this service')
    total += (match.shipmentCost ?? 0) + (match.otherCost ?? 0)
  }
  return { total: Math.round(total * 100) / 100, currency: 'USD' }
}

// ─── Create ──────────────────────────────────────────────────────────────────
export async function createManualShipment(input: ManualLabelInput): Promise<CreatedShipment> {
  const carrier = CARRIER_LABEL[input.path]
  const serviceLabel = serviceLabelFor(input.path, input.serviceCode)
  const reference = input.referenceNumber?.trim() || undefined

  let masterTracking = ''
  let cost: number | null = null
  let currency = 'USD'
  const pieces: LabelPiece[] = []
  // rows to persist: [trackingNumber, shipmentId, labelData, perPieceCost]
  const persist: Array<{ trackingNumber: string; shipmentId: string; labelData: string; cost: number | null }> = []

  if (input.path === 'ups') {
    const result = await generateUpsMultiPieceLabels(
      { shipFrom: toMPAddress(input.shipFrom), shipTo: toMPAddress(input.shipTo), serviceCode: input.serviceCode,
        packages: upsPackages(input.packages), confirmation: input.confirmation, referenceNumber: reference, description: reference ?? 'Manual shipment' },
      input.upsCredentialId,
    )
    cost = result.shipmentCost != null ? Number(result.shipmentCost) : null
    currency = result.currency ?? 'USD'
    for (const p of result.pieces) {
      pieces.push({ trackingNumber: p.trackingNumber, labelBase64: p.labelBase64, labelFormat: p.labelFormat })
      persist.push({ trackingNumber: p.trackingNumber, shipmentId: result.shipmentId, labelData: p.labelBase64, cost: null })
    }
    masterTracking = pieces[0]?.trackingNumber ?? result.shipmentId
    if (cost != null && persist[0]) persist[0].cost = cost
  } else if (input.path === 'fedex') {
    const creds = await loadFedExCredentials()
    if (!creds) throw new Error('FedEx credentials not configured — add them in Settings → FedEx.')
    const sig = input.confirmation && input.confirmation !== 'none' ? FEDEX_SIG[input.confirmation] : undefined
    const params = { shipFrom: fedexAddr(input.shipFrom), shipTo: fedexAddr(input.shipTo), packages: fedexPackages(input.packages),
      serviceType: input.serviceCode, ...(sig ? { signatureType: sig } : {}), reference }
    const fx = await createMultiPieceShipment(creds, params)
    masterTracking = fx.masterTrackingNumber
    for (const p of fx.pieces) {
      pieces.push({ trackingNumber: p.trackingNumber, labelBase64: p.labelData, labelFormat: p.labelFormat })
      persist.push({ trackingNumber: p.trackingNumber, shipmentId: fx.masterTrackingNumber, labelData: p.labelData, cost: null })
    }
    try { cost = (await getMultiPieceRate(creds, params)).total } catch { /* cost is best-effort */ }
    if (cost != null && persist[0]) persist[0].cost = cost
  } else {
    // ShipStation UPS — one label per box (each its own tracking number).
    const client = await ssClient()
    const shipDate = new Date().toISOString().slice(0, 10)

    // Resolve the EXACT carrierCode + serviceCode from a live rate. ShipStation's
    // createlabel rejects codes that don't precisely match the account with a
    // generic "The request is invalid", and our hardcoded codes may not match.
    const first = input.packages[0]
    const rates = await client.getRates({
      carrierCode: SS_CARRIER_CODE, serviceCode: input.serviceCode,
      fromPostalCode: input.shipFrom.postal, fromCity: input.shipFrom.city, fromState: input.shipFrom.state,
      toPostalCode: input.shipTo.postal, toCity: input.shipTo.city, toState: input.shipTo.state, toCountry: input.shipTo.country || 'US',
      weight: ssWeight(first), dimensions: ssDims(first), confirmation: input.confirmation ?? 'none',
    })
    const rate = rates.find(r => r.serviceCode === input.serviceCode) ?? rates[0]
    if (!rate) throw new Error(`ShipStation returned no UPS rate for this shipment. Available services: ${rates.map(r => r.serviceCode).join(', ') || 'none'}`)
    const carrierCode = rate.carrierCode
    const svcCode = rate.serviceCode

    let sum = 0
    for (const p of input.packages) {
      const label = await client.createLabel({
        carrierCode, serviceCode: svcCode, confirmation: input.confirmation ?? 'none', shipDate,
        weight: ssWeight(p), dimensions: ssDims(p) ?? { units: 'inches', length: 1, width: 1, height: 1 },
        shipFrom: toSSAddress(input.shipFrom), shipTo: toSSAddress(input.shipTo), orderNumber: reference,
      })
      pieces.push({ trackingNumber: label.trackingNumber, labelBase64: label.labelData, labelFormat: label.labelFormat || 'pdf' })
      persist.push({ trackingNumber: label.trackingNumber, shipmentId: String(label.shipmentId), labelData: label.labelData, cost: label.shipmentCost ?? null })
      sum += label.shipmentCost ?? 0
    }
    masterTracking = pieces[0]?.trackingNumber ?? ''
    cost = Math.round(sum * 100) / 100
  }

  if (pieces.length === 0) throw new Error('No labels were created')

  const labelType = input.path === 'ups' ? 'MANUAL_UPS' : input.path === 'fedex' ? 'MANUAL_FEDEX' : 'MANUAL_SS'
  const w = input.packages[0]
  await prisma.$transaction(persist.map(pp => prisma.returnLabel.create({
    data: {
      // ReturnLabel stores the DESTINATION in its shipFrom* columns (table convention).
      shipFromName: input.shipTo.name || input.shipTo.company || '—',
      shipFromAddress1: input.shipTo.address1, shipFromCity: input.shipTo.city,
      shipFromState: input.shipTo.state, shipFromPostal: input.shipTo.postal, shipFromCountry: input.shipTo.country || 'US',
      serviceCode: input.serviceCode, serviceLabel,
      weightValue: new Prisma.Decimal(String(w?.weightValue ?? 1)), weightUnit: w?.weightUnit === 'OZS' ? 'OZS' : 'LBS',
      trackingNumber: pp.trackingNumber, shipmentId: pp.shipmentId, labelData: pp.labelData,
      shipmentCost: pp.cost != null ? new Prisma.Decimal(pp.cost.toFixed(2)) : null, currency,
      labelType, upsCredentialId: input.path === 'ups' ? (input.upsCredentialId ?? null) : null,
    },
  })))

  return { path: input.path, carrier, serviceLabel, masterTracking, shipmentCost: cost, currency, pieces }
}

/** Validate a raw request body into a ManualLabelInput, or throw a user-facing error. */
export function parseManualLabelInput(body: unknown): ManualLabelInput {
  const b = (body ?? {}) as Record<string, unknown>
  const path = b.path
  if (path !== 'ups' && path !== 'fedex' && path !== 'ss') throw new Error('Choose a shipping path (UPS, FedEx, or ShipStation)')
  const addr = (a: unknown, which: string): LabelAddress => {
    const o = (a ?? {}) as Record<string, unknown>
    const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '')
    if (!s('name') && !s('company')) throw new Error(`${which}: name is required`)
    if (!s('address1') || !s('city') || !s('state') || !s('postal')) throw new Error(`${which}: address, city, state and ZIP are required`)
    return { name: s('name') || s('company'), company: s('company') || undefined, address1: s('address1'), address2: s('address2') || undefined,
      city: s('city'), state: s('state'), postal: s('postal'), country: s('country') || 'US', phone: s('phone') || undefined }
  }
  const pkgs = Array.isArray(b.packages) ? b.packages : []
  const packages: LabelPackage[] = pkgs.map((p, i) => {
    const o = (p ?? {}) as Record<string, unknown>
    const wv = Number(o.weightValue)
    if (!Number.isFinite(wv) || wv <= 0) throw new Error(`Box ${i + 1}: weight must be greater than 0`)
    return { weightValue: wv, weightUnit: o.weightUnit === 'OZS' ? 'OZS' : 'LBS',
      length: o.length ? Number(o.length) : undefined, width: o.width ? Number(o.width) : undefined,
      height: o.height ? Number(o.height) : undefined, dimUnit: o.dimUnit === 'CM' ? 'CM' : 'IN' }
  })
  if (packages.length === 0) throw new Error('Add at least one box')
  const serviceCode = typeof b.serviceCode === 'string' ? b.serviceCode.trim() : ''
  if (!serviceCode) throw new Error('Select a service')
  return {
    path, shipFrom: addr(b.shipFrom, 'Ship From'), shipTo: addr(b.shipTo, 'Ship To'), packages, serviceCode,
    confirmation: (['none', 'delivery', 'signature', 'adult_signature'].includes(String(b.confirmation)) ? b.confirmation : 'none') as ManualLabelInput['confirmation'],
    referenceNumber: typeof b.referenceNumber === 'string' ? b.referenceNumber : undefined,
    upsCredentialId: typeof b.upsCredentialId === 'string' && b.upsCredentialId ? b.upsCredentialId : undefined,
  }
}
