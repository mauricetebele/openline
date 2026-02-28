/**
 * GET  /api/messaging/[orderId]
 *   - Looks up the order in our DB for context (buyer name, items, etc.)
 *   - Calls SP-API GET /messaging/v1/orders/{id} to get available message actions
 *   - Returns local message history from order_messages table
 *
 * POST /api/messaging/[orderId]
 *   Body: { messageType: string, body: string }
 *   - Sends a message via SP-API POST /messaging/v1/orders/{id}/messages/{type}
 *   - Persists the sent message to order_messages for local history
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'

export const dynamic = 'force-dynamic'

// ─── SP-API response shapes ───────────────────────────────────────────────────

interface MessagingAction {
  href: string
  name: string
}
interface GetMessagingActionsResponse {
  _links?: {
    self?:    { href: string }
    actions?: MessagingAction[]
  }
  errors?: { code: string; message: string }[]
}

// Human-readable labels for each SP-API message type
const MESSAGE_TYPE_LABELS: Record<string, string> = {
  confirmOrderDetails:          'Confirm Order Details',
  confirmDeliveryDetails:       'Confirm Delivery Details',
  legalDisclosure:              'Legal Disclosure',
  negativeFeedbackRemoval:      'Request Negative Feedback Removal',
  confirmCustomizationDetails:  'Confirm Customization Details',
  unexpectedProblem:            'Unexpected Problem',
  sendDigitalAccessKey:         'Send Digital Access Key',
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const amazonOrderId = params.orderId.trim().toUpperCase()

  // 1. Look up in our DB for order context (optional — order may not be in DB)
  const dbOrder = await prisma.order.findFirst({
    where: { amazonOrderId },
    include: {
      items: { select: { asin: true, sellerSku: true, title: true, quantityOrdered: true } },
    },
  })

  // 2. Try SP-API for available messaging actions (optional — works even with no account)
  let availableActions: { name: string; label: string }[] = []
  let messagingError: string | null = null
  try {
    const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
    if (account) {
      const client = new SpApiClient(account.id)
      const resp = await client.get<GetMessagingActionsResponse>(
        `/messaging/v1/orders/${amazonOrderId}`,
        { marketplaceIds: account.marketplaceId },
      )
      if (resp?.errors?.length) {
        messagingError = resp.errors.map(e => `${e.code}: ${e.message}`).join('; ')
      } else {
        availableActions = (resp?._links?.actions ?? []).map(a => ({
          name:  a.name,
          label: MESSAGE_TYPE_LABELS[a.name] ?? a.name,
        }))
      }
    }
  } catch (err: unknown) {
    messagingError = err instanceof Error ? err.message : String(err)
  }

  // 4. Fetch local sent-message history
  const sentMessages = await prisma.orderMessage.findMany({
    where: { amazonOrderId },
    orderBy: { sentAt: 'desc' },
  })

  return NextResponse.json({
    amazonOrderId,
    order: dbOrder ? {
      id:            dbOrder.id,
      olmNumber:     dbOrder.olmNumber,
      purchaseDate:  dbOrder.purchaseDate,
      orderStatus:   dbOrder.orderStatus,
      shipToName:    dbOrder.shipToName,
      shipToCity:    dbOrder.shipToCity,
      shipToState:   dbOrder.shipToState,
      shipToPostal:  dbOrder.shipToPostal,
      items:         dbOrder.items,
    } : null,
    availableActions,
    messagingError,
    sentMessages,
  })
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const amazonOrderId = params.orderId.trim().toUpperCase()

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { messageType, body: messageBody, isInbound, manual } =
    body as { messageType?: string; body?: string; isInbound?: boolean; manual?: boolean }

  if (!messageBody?.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 })
  }

  // ── Inbound: log a buyer reply locally ───────────────────────────────────
  if (isInbound) {
    const saved = await prisma.orderMessage.create({
      data: {
        amazonOrderId,
        messageType: 'buyerReply',
        body:        messageBody.trim(),
        isInbound:   true,
        sentBy:      null,
      },
    })
    return NextResponse.json({ ok: true, message: saved })
  }

  // ── Outbound manual log: record without calling SP-API ───────────────────
  // Used when the order is past the messaging window or for messages already
  // sent via Seller Central that the user wants to log for reference.
  if (manual) {
    const saved = await prisma.orderMessage.create({
      data: {
        amazonOrderId,
        messageType: messageType ?? 'manualLog',
        body:        messageBody.trim(),
        isInbound:   false,
        sentBy:      user.email ?? undefined,
      },
    })
    return NextResponse.json({ ok: true, message: saved, apiSent: false })
  }

  // ── Outbound via SP-API ───────────────────────────────────────────────────
  if (!messageType) {
    return NextResponse.json({ error: 'messageType is required for outbound messages' }, { status: 400 })
  }

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) {
    return NextResponse.json({ error: 'No active Amazon account found' }, { status: 400 })
  }

  const client = new SpApiClient(account.id)

  try {
    await client.post(
      `/messaging/v1/orders/${amazonOrderId}/messages/${messageType}`,
      { text: messageBody.trim() },
      { marketplaceIds: account.marketplaceId },
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `SP-API send failed: ${msg}` }, { status: 502 })
  }

  const saved = await prisma.orderMessage.create({
    data: {
      amazonOrderId,
      messageType,
      body:      messageBody.trim(),
      isInbound: false,
      sentBy:    user.email ?? undefined,
    },
  })

  return NextResponse.json({ ok: true, message: saved, apiSent: true })
}
