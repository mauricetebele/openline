import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import {
  createMfnShipment,
  MfnShipmentRequestDetails,
  MfnDeliveryExperience,
} from '@/lib/amazon/mfn'

export const dynamic = 'force-dynamic'

const CONFIRMATION_MAP: Record<string, MfnDeliveryExperience> = {
  none:            'DeliveryConfirmationWithoutSignature',
  delivery:        'DeliveryConfirmationWithoutSignature',
  signature:       'DeliveryConfirmationWithSignature',
  adult_signature: 'DeliveryConfirmationWithAdultSignature',
}

const WEIGHT_UNIT_MAP: Record<string, 'oz' | 'lb' | 'g' | 'kg'> = {
  ounces:    'oz',
  pounds:    'lb',
  grams:     'g',
  kilograms: 'kg',
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    accountId,
    amazonOrderId,
    orderItems,
    shipFrom,
    packageDimensions,
    weight,
    confirmation,
    shippingServiceId,
    shippingServiceOfferId,
  } = body

  if (!accountId || !amazonOrderId || !shippingServiceId || !shippingServiceOfferId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const details: MfnShipmentRequestDetails = {
    AmazonOrderId: amazonOrderId,
    ItemList: (orderItems as { orderItemId: string; quantityOrdered: number }[]).map(i => ({
      OrderItemId: i.orderItemId,
      Quantity:    i.quantityOrdered,
    })),
    ShipFromAddress: {
      Name:                shipFrom.name || 'Seller',
      AddressLine1:        shipFrom.street1,
      AddressLine2:        shipFrom.street2 ?? undefined,
      City:                shipFrom.city,
      StateOrProvinceCode: shipFrom.state,
      PostalCode:          shipFrom.postalCode,
      CountryCode:         shipFrom.country || 'US',
    },
    PackageDimensions: {
      Length: packageDimensions.length,
      Width:  packageDimensions.width,
      Height: packageDimensions.height,
      Unit:   packageDimensions.unit === 'centimeters' ? 'centimeters' : 'inches',
    },
    Weight: {
      Value: weight.value,
      Unit:  WEIGHT_UNIT_MAP[weight.unit] ?? 'oz',
    },
    ShipDate: new Date().toISOString(),
    ShippingServiceOptions: {
      DeliveryExperience: CONFIRMATION_MAP[confirmation ?? 'none'] ?? 'DeliveryConfirmationWithoutSignature',
      CarrierWillPickUp: false,
    },
  }

  try {
    const shipment = await createMfnShipment(accountId, details, shippingServiceId, shippingServiceOfferId)
    return NextResponse.json({
      trackingNumber: shipment.TrackingId,
      labelData:      shipment.Label.FileContents.Contents,
      labelFormat:    shipment.Label.FileContents.FileType.includes('pdf') ? 'pdf' : 'png',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create shipment'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
