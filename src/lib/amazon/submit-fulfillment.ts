/**
 * Submit order fulfillment confirmation to Amazon via the Feeds API.
 * Includes Transparency codes when present on order items.
 *
 * Flow:
 *   1. Create feed document (get presigned upload URL)
 *   2. Upload XML feed content
 *   3. Create the feed
 *   4. Return feedId for optional status polling
 */
import { SpApiClient } from './sp-api'
import { prisma } from '@/lib/prisma'

interface FulfillmentItem {
  orderItemId: string
  quantity: number
  transparencyCodes: string[]
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildFulfillmentXml(
  sellerId: string,
  amazonOrderId: string,
  trackingNumber: string,
  carrier: string,
  items: FulfillmentItem[],
  shipDate?: string | null,
): string {
  const itemsXml = items
    .map(item => {
      const codesXml = item.transparencyCodes
        .map(code => `        <TransparencyCode>${escapeXml(code)}</TransparencyCode>`)
        .join('\n')

      return [
        '      <Item>',
        `        <AmazonOrderItemCode>${escapeXml(item.orderItemId)}</AmazonOrderItemCode>`,
        `        <Quantity>${item.quantity}</Quantity>`,
        codesXml,
        '      </Item>',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="utf-8"?>
<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">
  <Header>
    <DocumentVersion>1.01</DocumentVersion>
    <MerchantIdentifier>${escapeXml(sellerId)}</MerchantIdentifier>
  </Header>
  <MessageType>OrderFulfillment</MessageType>
  <Message>
    <MessageID>1</MessageID>
    <OrderFulfillment>
      <AmazonOrderID>${escapeXml(amazonOrderId)}</AmazonOrderID>
      <FulfillmentDate>${shipDate ? `${shipDate}T12:00:00` : new Date().toISOString()}</FulfillmentDate>
      <FulfillmentData>
        <CarrierCode>${escapeXml(carrier)}</CarrierCode>
        <ShipperTrackingNumber>${escapeXml(trackingNumber)}</ShipperTrackingNumber>
      </FulfillmentData>
${itemsXml}
    </OrderFulfillment>
  </Message>
</AmazonEnvelope>`
}

/**
 * Submit fulfillment confirmation to Amazon including Transparency codes.
 * Called after a real label is saved for an order.
 */
export async function submitFulfillmentWithTransparency(
  orderId: string,
  trackingNumber: string,
  carrier: string,
  shipDate?: string | null,
): Promise<{ feedId: string } | null> {
  // Load order with items and account info
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      account: { select: { id: true, sellerId: true, marketplaceId: true } },
    },
  })

  if (!order) {
    console.error('[submitFulfillment] Order not found:', orderId)
    return null
  }

  // Only submit if at least one item has transparency codes
  const itemsWithCodes = order.items.filter(i => i.transparencyCodes.length > 0)
  if (itemsWithCodes.length === 0) return null

  const client = new SpApiClient(order.accountId)

  const fulfillmentItems: FulfillmentItem[] = order.items.map(item => ({
    orderItemId: item.orderItemId,
    quantity: item.quantityOrdered,
    transparencyCodes: item.transparencyCodes,
  }))

  // Map common carrier codes to Amazon-expected values
  const carrierMap: Record<string, string> = {
    stamps_com: 'USPS',
    usps: 'USPS',
    ups: 'UPS',
    ups_walleted: 'UPS',
    fedex: 'FedEx',
    dhl_express: 'DHL',
    amazon_shipping: 'Amazon Shipping',
  }
  const amazonCarrier = carrierMap[carrier.toLowerCase()] ?? carrier

  const feedXml = buildFulfillmentXml(
    order.account.sellerId,
    order.amazonOrderId,
    trackingNumber,
    amazonCarrier,
    fulfillmentItems,
    shipDate ?? order.presetShipDate,
  )

  // Step 1: Create feed document
  const docResp = await client.post<{ feedDocumentId: string; url: string }>(
    '/feeds/2021-06-30/documents',
    { contentType: 'text/xml; charset=UTF-8' },
  )

  // Step 2: Upload XML to presigned URL
  await fetch(docResp.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
    body: feedXml,
  })

  // Step 3: Create the feed
  const feedResp = await client.post<{ feedId: string }>(
    '/feeds/2021-06-30/feeds',
    {
      feedType: 'POST_ORDER_FULFILLMENT_DATA',
      marketplaceIds: [order.account.marketplaceId],
      inputFeedDocumentId: docResp.feedDocumentId,
    },
  )

  console.log(
    `[submitFulfillment] Feed submitted for order ${order.amazonOrderId}: feedId=${feedResp.feedId}`,
  )

  return { feedId: feedResp.feedId }
}
