/**
 * POST /api/orders/[orderId]/rates
 * Get eligible shipping services via MerchantFulfillment API.
 * Body: { accountId, shipFrom, packageDimensions, weight }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orderId } = params
    const body = await req.json()
    const { accountId, shipFrom, packageDimensions, weight } = body

    const order = await prisma.order.findFirst({
      where: { id: orderId, accountId },
      include: { items: true },
    })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.orderStatus === 'Shipped') {
      return NextResponse.json({ error: 'Order is already marked as Shipped on Amazon' }, { status: 422 })
    }

    const client = new SpApiClient(accountId)

    const payload = {
      ShipmentRequestDetails: {
        AmazonOrderId: order.amazonOrderId,
        ItemList: order.items.map(item => ({
          OrderItemId: item.orderItemId,
          Quantity: item.quantityOrdered,
        })),
        ShipFromAddress: {
          Name: shipFrom.name,
          AddressLine1: shipFrom.addressLine1,
          City: shipFrom.city,
          StateOrProvinceCode: shipFrom.state,
          PostalCode: shipFrom.postalCode,
          CountryCode: shipFrom.countryCode ?? 'US',
          Phone: shipFrom.phone,
        },
        PackageDimensions: {
          Length: packageDimensions.length,
          Width: packageDimensions.width,
          Height: packageDimensions.height,
          Unit: packageDimensions.unit ?? 'inches',
        },
        Weight: {
          Value: weight.value,
          Unit: weight.unit ?? 'ounces',
        },
        ShippingServiceOptions: {
          DeliveryExperience: 'DeliveryConfirmationWithoutSignature',
          CarrierWillPickUp: false,
          CarrierWillPickUpOption: 'ShipperWillDropOff',
        },
      },
    }

    const resp = await client.post('/mfn/v0/eligibleShippingServices', payload)
    const services = (resp as Record<string, unknown>)?.payload as Record<string, unknown>
    return NextResponse.json({ services })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/orders/[orderId]/rates]', message)
    if (message.includes('403')) {
      return NextResponse.json({
        error: 'Access denied (403). The SP-API application is missing the "Merchant Fulfillment" role. ' +
          'Go to Seller Central → Apps & Services → Develop Apps, edit your app, add the Merchant Fulfillment role, then re-authorize.',
      }, { status: 403 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
