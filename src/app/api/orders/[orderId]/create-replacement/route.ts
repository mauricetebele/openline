/**
 * POST /api/orders/[orderId]/create-replacement
 *
 * Creates a free replacement order for a BackMarket order. The new order is a
 * normal BackMarket order that flows through the fulfillment grid (Pending →
 * process → ship), but is flagged `isReplacement: true` so it carries no
 * revenue and is excluded from the profitability / sales reports.
 *
 * The caller supplies the (editable) line items — each must resolve to an
 * internal Product SKU + Grade so the order can be processed downstream.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'

interface ReplItemInput {
  sellerSku: string
  title?: string | null
  quantityOrdered?: number
  gradeId?: string | null
  itemPrice?: number | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params

  const parent = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, accountId: true, orderSource: true, olmNumber: true,
      shipToName: true, shipToAddress1: true, shipToAddress2: true, shipToCity: true,
      shipToState: true, shipToPostal: true, shipToCountry: true, shipToPhone: true,
    },
  })
  if (!parent) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (parent.orderSource !== 'backmarket') {
    return NextResponse.json({ error: 'Replacement orders can only be created for BackMarket orders' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const rawItems: ReplItemInput[] = Array.isArray(body?.items) ? body.items : []
  const items = rawItems
    .map(it => ({
      sellerSku: String(it.sellerSku ?? '').trim(),
      title: it.title != null ? String(it.title) : null,
      quantityOrdered: Math.max(1, Math.floor(Number(it.quantityOrdered) || 1)),
      gradeId: it.gradeId ? String(it.gradeId) : null,
      itemPrice: it.itemPrice != null && !isNaN(Number(it.itemPrice)) ? Number(it.itemPrice) : 0,
    }))
    .filter(it => it.sellerSku)
  if (items.length === 0) {
    return NextResponse.json({ error: 'At least one item with a resolved product SKU is required' }, { status: 400 })
  }

  /** Atomically allocate the next OLM number (min 1000), mirroring the sync. */
  const nextOlmNumber = async (): Promise<number> => {
    const agg = await prisma.order.aggregate({ _max: { olmNumber: true } })
    return (agg._max.olmNumber ?? 999) + 1
  }

  const numberOfItemsUnshipped = items.reduce((s, i) => s + i.quantityOrdered, 0)

  // Retry on OLM/amazonOrderId unique conflicts, same as the BM sync.
  let created: { id: string; olmNumber: number | null } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const olmNumber = await nextOlmNumber()
    // amazonOrderId is composite-unique (accountId, amazonOrderId, orderSource).
    // olmNumber is globally unique, so REPL-<olm> is a safe synthetic id.
    const amazonOrderId = `REPL-${olmNumber}`
    try {
      created = await prisma.order.create({
        data: {
          accountId: parent.accountId,
          amazonOrderId,
          olmNumber,
          orderSource: 'backmarket',
          // 'Accepted', not 'Unshipped': a replacement is not a real BackMarket
          // order, so it must never be "Confirmed" against the BM API. Starting
          // it accepted makes it immediately shippable in the fulfillment grid.
          orderStatus: 'Accepted',
          workflowStatus: 'PENDING',
          purchaseDate: new Date(),
          lastUpdateDate: new Date(),
          orderTotal: 0,
          currency: 'USD',
          fulfillmentChannel: 'BACKMARKET',
          numberOfItemsUnshipped,
          shipToName: parent.shipToName,
          shipToAddress1: parent.shipToAddress1,
          shipToAddress2: parent.shipToAddress2,
          shipToCity: parent.shipToCity,
          shipToState: parent.shipToState,
          shipToPostal: parent.shipToPostal,
          shipToCountry: parent.shipToCountry,
          shipToPhone: parent.shipToPhone,
          isPrime: false,
          isReplacement: true,
          replacedOrderId: parent.id,
          lastSyncedAt: new Date(),
          items: {
            create: items.map((it, idx) => ({
              orderItemId: `repl-${idx + 1}`,
              sellerSku: it.sellerSku,
              title: it.title,
              quantityOrdered: it.quantityOrdered,
              quantityShipped: 0,
              itemPrice: it.itemPrice,
              gradeId: it.gradeId,
            })),
          },
        },
        select: { id: true, olmNumber: true },
      })
      break
    } catch (err) {
      const isUniqueConflict = err instanceof Error &&
        (err.message.includes('olmNumber') || err.message.includes('amazonOrderId') || err.message.includes('Unique'))
      if (isUniqueConflict && attempt < 2) continue
      const message = err instanceof Error ? err.message : String(err)
      console.error('[create-replacement] failed:', message)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }
  if (!created) return NextResponse.json({ error: 'Failed to allocate replacement order' }, { status: 500 })

  await logAuditEvent({
    entityType: 'order',
    entityId: created.id,
    action: 'replacement_created',
    after: {
      olmNumber: created.olmNumber,
      replacedOrderId: parent.id,
      replacedOlmNumber: parent.olmNumber,
      items: items.map(i => ({ sellerSku: i.sellerSku, quantity: i.quantityOrdered, gradeId: i.gradeId })),
    },
    actorId: user.dbId,
    actorLabel: user.email,
  }).catch(e => console.error('[create-replacement] audit log failed:', e))

  return NextResponse.json({ success: true, order: created })
}
