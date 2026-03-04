/**
 * POST /api/orders/check-cancellations
 * Body: { accountId: string }
 *
 * Streams SSE progress as it checks each active Amazon order for buyer
 * cancellation requests via the SP-API GetOrder detail endpoint.
 *
 * Events:
 *   { type: 'progress', checked, total, current }
 *   { type: 'done', checked, flagged: [...] }
 *   { type: 'error', error }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from '@/lib/amazon/sp-api'
import { requireAdmin, requireActiveAccount } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DETAIL_BURST    = 30
const DETAIL_SLEEP_MS = 1_100  // ~1 req/s after burst
const MAX_ORDER_AGE_DAYS = 14  // only check orders from the last 14 days

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

interface SpOrderDetail {
  AmazonOrderId?: string
  IsBuyerRequestedCancel?: boolean
  BuyerRequestedCancelReason?: string
}
interface GetOrderResp {
  payload?: SpOrderDetail
  errors?: { code: string; message: string }[]
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  let body: { accountId?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { accountId } = body
  if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

  const accountOrErr = await requireActiveAccount(accountId)
  if (accountOrErr instanceof NextResponse) return accountOrErr

  const client = new SpApiClient(accountId)

  // Obtain a Restricted Data Token so the GetOrder response includes
  // IsBuyerRequestedCancel, BuyerCancelReason, and full BuyerInfo.
  let rdt: string | null = null
  try {
    rdt = await client.getRestrictedDataToken([
      { method: 'GET', path: '/orders/v0/orders', dataElements: ['buyerInfo'] },
    ])
  } catch (e) {
    console.warn('[check-cancellations] Failed to get RDT, falling back to regular token:', e instanceof Error ? e.message : String(e))
  }

  // Only check orders from the last 14 days to keep it fast
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - MAX_ORDER_AGE_DAYS)

  const activeOrders = await prisma.order.findMany({
    where: {
      accountId,
      orderSource: 'amazon',
      workflowStatus: { in: ['PENDING', 'PROCESSING', 'AWAITING_VERIFICATION'] },
      purchaseDate: { gte: cutoff },
    },
    select: { id: true, amazonOrderId: true },
    orderBy: { purchaseDate: 'desc' },
  })

  if (activeOrders.length === 0) {
    return NextResponse.json({ checked: 0, flagged: [] })
  }

  console.log(`[check-cancellations] Checking ${activeOrders.length} orders (last ${MAX_ORDER_AGE_DAYS} days)`)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const flaggedIds = new Set<string>()
      const cancelReasons = new Map<string, string | null>()
      let detailCalls = 0
      let debugSample: Record<string, unknown> | null = null

      try {
        for (let i = 0; i < activeOrders.length; i++) {
          const order = activeOrders[i]

          try {
            if (detailCalls >= DETAIL_BURST) await sleep(DETAIL_SLEEP_MS)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const resp = rdt
              ? await client.getWithRDT<any>(`/orders/v0/orders/${order.amazonOrderId}`, rdt)
              : await client.get<any>(`/orders/v0/orders/${order.amazonOrderId}`, {})
            detailCalls++

            // Capture first raw response for debugging
            if (detailCalls === 1) {
              debugSample = {
                orderId: order.amazonOrderId,
                topKeys: Object.keys(resp ?? {}),
                payloadKeys: Object.keys(resp?.payload ?? {}),
                // Grab all cancel-related fields at any level
                IsBuyerRequestedCancel: resp?.payload?.IsBuyerRequestedCancel,
                BuyerCancelReason: resp?.payload?.BuyerCancelReason,
                BuyerRequestedCancelReason: resp?.payload?.BuyerRequestedCancelReason,
                OrderStatus: resp?.payload?.OrderStatus,
                // Check if nested in BuyerInfo
                BuyerInfo: resp?.payload?.BuyerInfo,
              }
            }

            const errors = resp?.errors
            if (Array.isArray(errors) && errors.length) {
              console.warn(`[check-cancellations] Error for ${order.amazonOrderId}:`, errors[0].message)
            } else {
              const detail = resp?.payload ?? resp  // fallback: maybe resp IS the payload
              const cancelVal = detail?.IsBuyerRequestedCancel
              const isCancelled = cancelVal === true || cancelVal === 'true' || cancelVal === 'True'
              if (isCancelled) {
                flaggedIds.add(order.amazonOrderId)
                cancelReasons.set(order.amazonOrderId, detail?.BuyerCancelReason ?? detail?.BuyerRequestedCancelReason ?? null)
              }
            }
          } catch (e) {
            console.warn(`[check-cancellations] Failed ${order.amazonOrderId}:`, e instanceof Error ? e.message : String(e))
          }

          // Send progress every 5 orders or on last
          if ((i + 1) % 5 === 0 || i === activeOrders.length - 1) {
            send({ type: 'progress', checked: i + 1, total: activeOrders.length, flaggedSoFar: flaggedIds.size })
          }
        }

        console.log(`[check-cancellations] ${detailCalls} calls, ${flaggedIds.size} flagged`)

        // Mark flagged orders
        if (flaggedIds.size > 0) {
          await prisma.$transaction(
            activeOrders
              .filter(o => flaggedIds.has(o.amazonOrderId))
              .map(o =>
                prisma.order.update({
                  where: { id: o.id },
                  data: {
                    isBuyerRequestedCancel: true,
                    buyerCancelReason: cancelReasons.get(o.amazonOrderId) ?? null,
                  },
                }),
              ),
          )
        }

        // Clear flag on orders no longer flagged
        const unflaggedOrders = activeOrders.filter(o => !flaggedIds.has(o.amazonOrderId))
        if (unflaggedOrders.length > 0) {
          await prisma.order.updateMany({
            where: {
              id: { in: unflaggedOrders.map(o => o.id) },
              isBuyerRequestedCancel: true,
            },
            data: { isBuyerRequestedCancel: false, buyerCancelReason: null },
          })
        }

        // Return flagged orders
        const flaggedOrders = await prisma.order.findMany({
          where: { accountId, isBuyerRequestedCancel: true },
          select: {
            id: true,
            amazonOrderId: true,
            olmNumber: true,
            buyerCancelReason: true,
            workflowStatus: true,
          },
          orderBy: { purchaseDate: 'desc' },
        })

        send({ type: 'done', checked: activeOrders.length, flagged: flaggedOrders, _debug: debugSample })
      } catch (fatalErr) {
        send({ type: 'error', error: fatalErr instanceof Error ? fatalErr.message : String(fatalErr) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
