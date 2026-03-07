import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import {
  getEligibleShippingServices,
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
  ounces:     'oz',
  pounds:     'lb',
  grams:      'g',
  kilograms:  'kg',
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    accountId,
    amazonOrderId,
    orderItems,        // [{ orderItemId, quantityOrdered }]
    shipFrom,          // { name, street1, street2?, city, state, postalCode, country }
    packageDimensions, // { length, width, height, unit }
    weight,            // { value, unit }
    confirmation,
    shipDate,
  } = body

  if (!accountId || !amazonOrderId) {
    return NextResponse.json({ error: 'accountId and amazonOrderId are required' }, { status: 400 })
  }

  const details: MfnShipmentRequestDetails = {
    AmazonOrderId: amazonOrderId,
    ItemList: (orderItems as { orderItemId: string; quantityOrdered: number }[]).map(i => ({
      OrderItemId: i.orderItemId,
      Quantity:    i.quantityOrdered,
    })),
    ShipFromAddress: {
      Name:                 shipFrom.name || 'Seller',
      AddressLine1:         shipFrom.street1,
      AddressLine2:         shipFrom.street2 ?? undefined,
      City:                 shipFrom.city,
      StateOrProvinceCode:  shipFrom.state,
      PostalCode:           shipFrom.postalCode,
      CountryCode:          shipFrom.country || 'US',
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
    ShipDate: shipDate ? `${shipDate}T12:00:00Z` : new Date().toISOString(),
    ShippingServiceOptions: {
      DeliveryExperience: CONFIRMATION_MAP[confirmation ?? 'none'] ?? 'DeliveryConfirmationWithoutSignature',
      CarrierWillPickUp: false,
    },
  }

  try {
    const rates = await getEligibleShippingServices(accountId, details)
    // Sort cheapest first
    rates.sort((a, b) => parseFloat(a.Rate.Amount) - parseFloat(b.Rate.Amount))
    return NextResponse.json(rates)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to get rates'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
