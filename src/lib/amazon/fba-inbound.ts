/**
 * FBA Inbound Shipment integration (SP-API Fulfillment Inbound v2024-03-20).
 *
 * Follows the same pattern as mfn.ts — typed interfaces + exported async
 * functions using SpApiClient.  Scope: SPD (Small Parcel Delivery),
 * Amazon-partnered carriers only.
 */
import { SpApiClient } from './sp-api'

// ─── Polling helper ──────────────────────────────────────────────────────────

const POLL_BASE_DELAY_MS = 2_000
const POLL_MAX_ATTEMPTS  = 30

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

export interface OperationStatus {
  operationId: string
  operationStatus: 'SUCCESS' | 'IN_PROGRESS' | 'FAILED'
  operationProblems?: Array<{ message: string; severity: string }>
}

/**
 * Poll an async Amazon operation until it completes or fails.
 * Uses exponential backoff: 2s → 4s → 8s … capped at ~60s per attempt.
 */
export async function pollOperationStatus(
  accountId: string,
  operationId: string,
): Promise<OperationStatus> {
  const client = new SpApiClient(accountId)

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const resp = await client.get<OperationStatus>(
      `/inbound/fba/2024-03-20/operations/${operationId}`,
    )

    if (resp.operationStatus === 'SUCCESS') return resp
    if (resp.operationStatus === 'FAILED') {
      const problems = resp.operationProblems?.map(p => p.message).join('; ') ?? 'Unknown error'
      throw new Error(`Amazon operation ${operationId} failed: ${problems}`)
    }

    // IN_PROGRESS — wait and retry
    const delay = Math.min(POLL_BASE_DELAY_MS * 2 ** attempt, 60_000)
    await sleep(delay)
  }

  throw new Error(`Amazon operation ${operationId} timed out after ${POLL_MAX_ATTEMPTS} attempts`)
}

// ─── FNSKU lookup ────────────────────────────────────────────────────────────

interface InventorySummary {
  fnSku?: string
  asin?: string
  sellerSku?: string
}

interface InventorySummariesResponse {
  payload?: {
    inventorySummaries?: InventorySummary[]
  }
  // v1 uses "inventorySummaries" at top level too
  inventorySummaries?: InventorySummary[]
}

/**
 * Fetch the FNSKU for a seller SKU via the FBA Inventory API.
 * Returns { fnsku, asin } or throws if not found.
 */
export async function fetchFnsku(
  accountId: string,
  marketplaceId: string,
  sellerSku: string,
): Promise<{ fnsku: string; asin: string | null }> {
  const client = new SpApiClient(accountId)
  const resp = await client.get<InventorySummariesResponse>(
    '/fba/inventory/v1/summaries',
    {
      granularityType: 'Marketplace',
      granularityId: marketplaceId,
      sellerSkus: sellerSku,
      details: 'true',
      marketplaceIds: marketplaceId,
    },
  )

  const summaries = resp.payload?.inventorySummaries ?? resp.inventorySummaries ?? []
  const match = summaries.find(s => s.sellerSku === sellerSku)
  if (!match?.fnSku) {
    throw new Error(`FNSKU not found for seller SKU "${sellerSku}"`)
  }

  return { fnsku: match.fnSku, asin: match.asin ?? null }
}

// ─── Inbound plan types ──────────────────────────────────────────────────────

export interface SourceAddress {
  name: string
  addressLine1: string
  addressLine2?: string
  city: string
  stateOrProvinceCode: string
  postalCode: string
  countryCode: string
  phoneNumber?: string
}

export interface InboundItem {
  msku: string           // seller SKU
  fnsku: string
  asin: string
  labelOwner: 'AMAZON' | 'SELLER' | 'NONE'
  quantity: number
  prepOwner: 'AMAZON' | 'SELLER' | 'NONE'
}

export interface CreateInboundPlanResponse {
  inboundPlanId: string
  operationId: string
}

export interface PackingOption {
  packingOptionId: string
  packingGroups: Array<{
    packingGroupId: string
    items: Array<{ msku: string; quantity: number }>
  }>
}

export interface PlacementOption {
  placementOptionId: string
  shipmentIds: string[]
  fees?: Array<{ type: string; amount: { amount: number; code: string } }>
}

export interface TransportationOption {
  transportationOptionId: string
  shippingMode: string
  shippingSolution: string
  carrier?: { name: string }
  quote?: { price: { amount: number; code: string } }
}

export interface DeliveryWindowOption {
  deliveryWindowOptionId: string
  startDate: string
  endDate: string
  availabilityType: string
}

// ─── 1. Create Inbound Plan ─────────────────────────────────────────────────

export async function createInboundPlan(
  accountId: string,
  opts: {
    sourceAddress: SourceAddress
    items: InboundItem[]
    marketplaceIds: string[]
  },
): Promise<CreateInboundPlanResponse> {
  const client = new SpApiClient(accountId)
  const body = {
    sourceAddress: opts.sourceAddress,
    items: opts.items.map(i => ({
      msku: i.msku,
      fnSku: i.fnsku,
      asin: i.asin,
      labelOwner: i.labelOwner,
      quantity: i.quantity,
      prepOwner: i.prepOwner,
    })),
    marketplaceIds: opts.marketplaceIds,
    destinationMarketplaces: opts.marketplaceIds,
  }
  return client.post<CreateInboundPlanResponse>(
    '/inbound/fba/2024-03-20/inboundPlans',
    body,
  )
}

// ─── 2. Generate Packing Options ────────────────────────────────────────────

export async function generatePackingOptions(
  accountId: string,
  inboundPlanId: string,
): Promise<{ operationId: string }> {
  const client = new SpApiClient(accountId)
  return client.post<{ operationId: string }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/packingOptions`,
    {},
  )
}

// ─── 3. List Packing Options ────────────────────────────────────────────────

export async function listPackingOptions(
  accountId: string,
  inboundPlanId: string,
): Promise<PackingOption[]> {
  const client = new SpApiClient(accountId)
  const resp = await client.get<{ packingOptions: PackingOption[] }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/packingOptions`,
  )
  return resp.packingOptions ?? []
}

// ─── 4. Confirm Packing Option ──────────────────────────────────────────────

export async function confirmPackingOption(
  accountId: string,
  inboundPlanId: string,
  packingOptionId: string,
): Promise<{ operationId: string }> {
  const client = new SpApiClient(accountId)
  return client.post<{ operationId: string }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/packingOptions/${packingOptionId}/confirmation`,
    {},
  )
}

// ─── 5. Set Packing Information ─────────────────────────────────────────────

export interface BoxInput {
  weight: { unit: 'LB'; value: number }
  dimensions: { unitOfMeasurement: 'IN'; length: number; width: number; height: number }
  items: Array<{ msku: string; fnSku: string; quantity: number; prepOwner: 'AMAZON' | 'SELLER' | 'NONE'; labelOwner: 'AMAZON' | 'SELLER' | 'NONE' }>
  contentInformationSource: 'BOX_CONTENT_PROVIDED'
  quantity: 1
}

export async function setPackingInformation(
  accountId: string,
  inboundPlanId: string,
  packingGroupId: string,
  boxes: BoxInput[],
): Promise<{ operationId: string }> {
  const client = new SpApiClient(accountId)
  return client.post<{ operationId: string }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/packingGroups/${packingGroupId}/packingInformation`,
    { packageGroupings: boxes.map(box => ({ boxes: [box] })) },
  )
}

// ─── 6. Generate Placement Options ──────────────────────────────────────────

export async function generatePlacementOptions(
  accountId: string,
  inboundPlanId: string,
): Promise<{ operationId: string }> {
  const client = new SpApiClient(accountId)
  return client.post<{ operationId: string }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/placementOptions`,
    {},
  )
}

// ─── 7. List Placement Options ──────────────────────────────────────────────

export async function listPlacementOptions(
  accountId: string,
  inboundPlanId: string,
): Promise<PlacementOption[]> {
  const client = new SpApiClient(accountId)
  const resp = await client.get<{ placementOptions: PlacementOption[] }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/placementOptions`,
  )
  return resp.placementOptions ?? []
}

// ─── 8. Confirm Placement Option ────────────────────────────────────────────

export async function confirmPlacementOption(
  accountId: string,
  inboundPlanId: string,
  placementOptionId: string,
): Promise<{ operationId: string }> {
  const client = new SpApiClient(accountId)
  return client.post<{ operationId: string }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/placementOptions/${placementOptionId}/confirmation`,
    {},
  )
}

// ─── 9. Generate Transportation Options ─────────────────────────────────────

export async function generateTransportationOptions(
  accountId: string,
  inboundPlanId: string,
  shipmentId: string,
): Promise<{ operationId: string }> {
  const client = new SpApiClient(accountId)
  return client.post<{ operationId: string }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/shipments/${shipmentId}/transportationOptions`,
    {},
  )
}

// ─── 10. List Transportation Options ────────────────────────────────────────

export async function listTransportationOptions(
  accountId: string,
  inboundPlanId: string,
  shipmentId: string,
): Promise<TransportationOption[]> {
  const client = new SpApiClient(accountId)
  const resp = await client.get<{ transportationOptions: TransportationOption[] }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/shipments/${shipmentId}/transportationOptions`,
  )
  return resp.transportationOptions ?? []
}

// ─── 11. Confirm Transportation Options ─────────────────────────────────────

export async function confirmTransportationOptions(
  accountId: string,
  inboundPlanId: string,
  shipmentId: string,
  transportOptionId: string,
): Promise<{ operationId: string }> {
  const client = new SpApiClient(accountId)
  return client.post<{ operationId: string }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/shipments/${shipmentId}/transportationOptions/${transportOptionId}/confirmation`,
    {},
  )
}

// ─── 12. Delivery Window Options ────────────────────────────────────────────

export async function generateDeliveryWindowOptions(
  accountId: string,
  inboundPlanId: string,
  shipmentId: string,
): Promise<{ operationId: string }> {
  const client = new SpApiClient(accountId)
  return client.post<{ operationId: string }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/shipments/${shipmentId}/deliveryWindowOptions`,
    {},
  )
}

export async function listDeliveryWindowOptions(
  accountId: string,
  inboundPlanId: string,
  shipmentId: string,
): Promise<DeliveryWindowOption[]> {
  const client = new SpApiClient(accountId)
  const resp = await client.get<{ deliveryWindowOptions: DeliveryWindowOption[] }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/shipments/${shipmentId}/deliveryWindowOptions`,
  )
  return resp.deliveryWindowOptions ?? []
}

export async function confirmDeliveryWindowOptions(
  accountId: string,
  inboundPlanId: string,
  shipmentId: string,
  deliveryWindowOptionId: string,
): Promise<{ operationId: string }> {
  const client = new SpApiClient(accountId)
  return client.post<{ operationId: string }>(
    `/inbound/fba/2024-03-20/inboundPlans/${inboundPlanId}/shipments/${shipmentId}/deliveryWindowOptions/${deliveryWindowOptionId}/confirmation`,
    {},
  )
}

// ─── 13. Get Shipment Labels (v0 API) ───────────────────────────────────────

export interface ShipmentLabelsResponse {
  DownloadURL?: string
  payload?: {
    DownloadURL?: string
  }
}

/**
 * Fetch shipment labels via the v0 Inbound API.
 * The v2024-03-20 API has no label endpoint, so we fall back to v0.
 */
export async function getShipmentLabels(
  accountId: string,
  amazonShipmentId: string,
): Promise<string> {
  const client = new SpApiClient(accountId)
  const resp = await client.get<ShipmentLabelsResponse>(
    `/fba/inbound/v0/shipments/${amazonShipmentId}/labels`,
    {
      PageType: 'PackageLabel_Letter_6',
      LabelType: 'UNIQUE',
    },
  )
  const url = resp.payload?.DownloadURL ?? resp.DownloadURL
  if (!url) throw new Error('No label download URL returned from Amazon')
  return url
}
