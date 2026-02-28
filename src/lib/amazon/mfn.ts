import { SpApiClient } from './sp-api'

// ─── Request shapes ──────────────────────────────────────────────────────────

export interface MfnAddress {
  Name: string
  AddressLine1: string
  AddressLine2?: string
  City: string
  StateOrProvinceCode: string
  PostalCode: string
  CountryCode: string
  Phone?: string
}

export interface MfnWeight {
  Value: number
  Unit: 'oz' | 'lb' | 'g' | 'kg'
}

export interface MfnDimensions {
  Length: number
  Width: number
  Height: number
  Unit: 'inches' | 'centimeters'
}

export interface MfnItem {
  OrderItemId: string
  Quantity: number
}

export type MfnDeliveryExperience =
  | 'DeliveryConfirmationWithAdultSignature'
  | 'DeliveryConfirmationWithSignature'
  | 'DeliveryConfirmationWithoutSignature'
  | 'NoTracking'

export interface MfnShipmentRequestDetails {
  AmazonOrderId: string
  ItemList: MfnItem[]
  ShipFromAddress: MfnAddress
  PackageDimensions: MfnDimensions
  Weight: MfnWeight
  ShipDate: string
  ShippingServiceOptions: {
    DeliveryExperience: MfnDeliveryExperience
    CarrierWillPickUp: boolean
  }
}

// ─── Response shapes ─────────────────────────────────────────────────────────

export interface MfnRate {
  ShippingServiceName: string
  CarrierName: string
  ShippingServiceId: string
  ShippingServiceOfferId: string
  ShipDate: string
  EarliestEstimatedDeliveryDate?: string
  LatestEstimatedDeliveryDate?: string
  Rate: { Amount: string; CurrencyCode: string }
  RequiresAdditionalSellerInputs: boolean
}

export interface MfnShipment {
  ShipmentId: string
  AmazonOrderId: string
  TrackingId: string
  Label: {
    FileContents: {
      Contents: string  // base64
      FileType: string  // 'application/pdf' | 'image/png' etc
      Checksum: string
    }
  }
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function getEligibleShippingServices(
  accountId: string,
  details: MfnShipmentRequestDetails,
): Promise<MfnRate[]> {
  const client = new SpApiClient(accountId)
  const resp = await client.post<{ payload: { ShippingServiceList: MfnRate[] } }>(
    '/mfn/v0/eligibleShippingServices',
    { ShipmentRequestDetails: details },
  )
  return resp.payload?.ShippingServiceList ?? []
}

export async function createMfnShipment(
  accountId: string,
  details: MfnShipmentRequestDetails,
  shippingServiceId: string,
  shippingServiceOfferId: string,
): Promise<MfnShipment> {
  const client = new SpApiClient(accountId)
  const resp = await client.post<{ payload: { Shipment: MfnShipment } }>(
    '/mfn/v0/shipments',
    {
      ShipmentRequestDetails: details,
      ShippingServiceId: shippingServiceId,
      ShippingServiceOfferId: shippingServiceOfferId,
    },
  )
  return resp.payload.Shipment
}
