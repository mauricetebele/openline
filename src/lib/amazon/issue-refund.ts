/**
 * Issue a refund to Amazon for a seller-fulfilled (MFN/FBM) order via the SP-API
 * Feeds API, using an OrderAdjustment / POST_PAYMENT_ADJUSTMENT_DATA feed.
 *
 * Mirrors the 3-step feed flow in submit-fulfillment.ts:
 *   1. create feed document (presigned upload URL)
 *   2. PUT the XML to that URL
 *   3. create the feed → feedId
 *
 * Refunds are irreversible once Amazon processes the feed. The caller (route)
 * is responsible for confirmation, double-refund guarding, and recording.
 */
import { SpApiClient } from './sp-api'
import { prisma } from '@/lib/prisma'

// Valid Amazon OrderAdjustment reason codes.
export const ADJUSTMENT_REASONS = ['GeneralAdjustment', 'CustomerReturn', 'CouldNotShip'] as const
export type AdjustmentReason = typeof ADJUSTMENT_REASONS[number]

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

interface AdjustedItem {
  orderItemCode: string
  principal: number
  tax: number
  shipping: number
}

function buildOrderAdjustmentXml(
  sellerId: string,
  amazonOrderId: string,
  currency: string,
  reason: AdjustmentReason,
  items: AdjustedItem[],
): string {
  const itemsXml = items.map(it => {
    const itemComponents: string[] = []
    if (it.principal > 0) itemComponents.push(`          <Component><Type>Principal</Type><Amount currency="${currency}">${money(it.principal)}</Amount></Component>`)
    if (it.tax > 0) itemComponents.push(`          <Component><Type>Tax</Type><Amount currency="${currency}">${money(it.tax)}</Amount></Component>`)
    const shipComponents: string[] = []
    if (it.shipping > 0) shipComponents.push(`          <Component><Type>Shipping</Type><Amount currency="${currency}">${money(it.shipping)}</Amount></Component>`)

    return [
      '      <AdjustedItem>',
      `        <AmazonOrderItemCode>${escapeXml(it.orderItemCode)}</AmazonOrderItemCode>`,
      `        <AdjustmentReason>${reason}</AdjustmentReason>`,
      itemComponents.length ? `        <ItemPriceAdjustments>\n${itemComponents.join('\n')}\n        </ItemPriceAdjustments>` : '',
      shipComponents.length ? `        <ShippingPriceAdjustments>\n${shipComponents.join('\n')}\n        </ShippingPriceAdjustments>` : '',
      '      </AdjustedItem>',
    ].filter(Boolean).join('\n')
  }).join('\n')

  return `<?xml version="1.0" encoding="utf-8"?>
<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">
  <Header>
    <DocumentVersion>1.01</DocumentVersion>
    <MerchantIdentifier>${escapeXml(sellerId)}</MerchantIdentifier>
  </Header>
  <MessageType>OrderAdjustment</MessageType>
  <Message>
    <MessageID>1</MessageID>
    <OrderAdjustment>
      <AmazonOrderID>${escapeXml(amazonOrderId)}</AmazonOrderID>
${itemsXml}
    </OrderAdjustment>
  </Message>
</AmazonEnvelope>`
}

export interface IssueRefundResult {
  feedId: string
  amount: number
  currency: string
}

/**
 * Build + submit the refund feed.
 * - mode 'full'   → refund every item's principal + tax + shipping.
 * - mode 'custom' → refund `customAmount` as principal on the first order item.
 */
export async function issueOrderRefund(
  orderId: string,
  opts: { reason: AdjustmentReason; mode: 'full' | 'custom'; customAmount?: number },
): Promise<IssueRefundResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { orderItemId: 'asc' } },
      account: { select: { id: true, sellerId: true, marketplaceId: true } },
    },
  })
  if (!order) throw new Error('Order not found')
  if (order.orderSource !== 'amazon') throw new Error('Refunds via this feed are only for Amazon orders')
  if (order.items.length === 0) throw new Error('Order has no items to refund')

  const currency = order.currency ?? 'USD'
  const num = (d: unknown) => (d == null ? 0 : Number(d))

  let adjusted: AdjustedItem[]
  let amount: number

  if (opts.mode === 'custom') {
    const custom = Math.round((opts.customAmount ?? 0) * 100) / 100
    if (!(custom > 0)) throw new Error('A positive refund amount is required')
    adjusted = [{ orderItemCode: order.items[0].orderItemId, principal: custom, tax: 0, shipping: 0 }]
    amount = custom
  } else {
    adjusted = order.items.map(i => ({
      orderItemCode: i.orderItemId,
      principal: num(i.itemPrice),
      tax: num(i.itemTax),
      shipping: num(i.shippingPrice),
    }))
    amount = adjusted.reduce((s, a) => s + a.principal + a.tax + a.shipping, 0)
    amount = Math.round(amount * 100) / 100
    if (!(amount > 0)) throw new Error('Order has no refundable amount (no item prices on record)')
  }

  const xml = buildOrderAdjustmentXml(order.account.sellerId, order.amazonOrderId, currency, opts.reason, adjusted)
  const client = new SpApiClient(order.accountId)

  // 1. feed document
  const doc = await client.post<{ feedDocumentId: string; url: string }>(
    '/feeds/2021-06-30/documents',
    { contentType: 'text/xml; charset=UTF-8' },
  )
  // 2. upload
  const up = await fetch(doc.url, { method: 'PUT', headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body: xml })
  if (!up.ok) throw new Error(`Failed to upload refund feed document (${up.status})`)
  // 3. create feed
  const feed = await client.post<{ feedId: string }>(
    '/feeds/2021-06-30/feeds',
    {
      feedType: 'POST_PAYMENT_ADJUSTMENT_DATA',
      marketplaceIds: [order.account.marketplaceId],
      inputFeedDocumentId: doc.feedDocumentId,
    },
  )

  return { feedId: feed.feedId, amount, currency }
}

/** Poll a feed's processing status (and result doc summary when available). */
export async function getRefundFeedStatus(
  accountId: string,
  feedId: string,
): Promise<{ processingStatus: string; result?: string }> {
  const client = new SpApiClient(accountId)
  const feed = await client.get<{ processingStatus: string; resultFeedDocumentId?: string }>(
    `/feeds/2021-06-30/feeds/${feedId}`,
  )
  let result: string | undefined
  if (feed.resultFeedDocumentId) {
    try {
      const resDoc = await client.get<{ url: string }>(`/feeds/2021-06-30/documents/${feed.resultFeedDocumentId}`)
      const txt = await (await fetch(resDoc.url)).text()
      result = txt.slice(0, 4000)
    } catch { /* result doc not critical */ }
  }
  return { processingStatus: feed.processingStatus, result }
}
