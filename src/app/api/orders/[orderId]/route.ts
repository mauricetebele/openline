import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { getRefundFeedStatus } from '@/lib/amazon/issue-refund'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        orderBy: { orderItemId: 'asc' },
      },
      label: true,
      serialAssignments: {
        include: {
          inventorySerial: {
            select: { serialNumber: true, product: { select: { sku: true } } },
          },
          orderItem: { select: { sellerSku: true } },
        },
      },
      marketplaceRMAs: {
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            include: {
              serials: {
                include: {
                  location: {
                    include: { warehouse: { select: { name: true } } },
                  },
                  grade: { select: { grade: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Historical SICKW/FMI checks for this order. SickwCheck has no FK — it's
  // keyed by the checked serial/IMEI — so gather every serial on the order
  // (shipped units, BackMarket serials, returned units) and batch-load.
  const serials = new Set<string>()
  for (const sa of order.serialAssignments) {
    if (sa.inventorySerial?.serialNumber) serials.add(sa.inventorySerial.serialNumber)
  }
  for (const item of order.items) {
    for (const s of (item.bmSerials ?? [])) if (s) serials.add(s)
  }
  for (const rma of order.marketplaceRMAs) {
    for (const item of rma.items) {
      for (const s of item.serials) if (s.serialNumber) serials.add(s.serialNumber)
    }
  }

  const rawChecks = serials.size > 0
    ? await prisma.sickwCheck.findMany({
        where: { imei: { in: Array.from(serials) } },
        orderBy: { createdAt: 'desc' },
      })
    : []
  const sickwChecks = rawChecks.map((c) => ({
    ...c,
    cost: c.cost != null ? Number(c.cost) : null, // Decimal → number over JSON
  }))

  // Amazon-native return authorization + replacement + issued-refund data. These
  // models have no FK to Order — they're keyed by the Amazon order ID string.
  const [mfnReturnsRaw, freeReplacements, refundsIssuedRaw] = order.orderSource === 'amazon'
    ? await Promise.all([
        prisma.mFNReturn.findMany({
          where: { orderId: order.amazonOrderId, accountId: order.accountId },
          orderBy: { returnDate: 'desc' },
        }),
        prisma.freeReplacement.findMany({
          where: { originalOrderId: order.amazonOrderId },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.amazonRefundIssued.findMany({
          where: { orderId: order.id },
          orderBy: { createdAt: 'desc' },
        }),
      ])
    : [[], [], []]

  // Resolve any still-in-flight seller-initiated refunds: a record is saved as
  // IN_QUEUE at submit time and only becomes SUCCESS/ERROR once Amazon processes
  // the feed, so refresh the feed result here (best-effort) before returning.
  const needsPoll = (s: string | null, result: string | null) =>
    s === 'IN_QUEUE' || s === 'IN_PROGRESS' || (s === 'DONE' && !result)
  for (const r of refundsIssuedRaw) {
    if (!r.feedId || !needsPoll(r.feedStatus, r.feedResult)) continue
    try {
      const status = await getRefundFeedStatus(r.accountId, r.feedId)
      if (status.processingStatus !== r.feedStatus || status.result) {
        await prisma.amazonRefundIssued.update({
          where: { id: r.id },
          data: { feedStatus: status.processingStatus, feedResult: status.result ?? undefined },
        })
        r.feedStatus = status.processingStatus
        r.feedResult = status.result ?? r.feedResult
      }
    } catch { /* best-effort */ }
  }

  const decimal = (d: unknown) => (d == null ? null : Number(d))
  const mfnReturns = mfnReturnsRaw.map((r) => ({
    ...r,
    returnValue: decimal(r.returnValue),
    labelCost: decimal(r.labelCost),
    orderAmount: decimal(r.orderAmount),
    refundedAmount: decimal(r.refundedAmount),
    safetReimbursement: decimal(r.safetReimbursement),
  }))
  const refundsIssued = refundsIssuedRaw.map((r) => ({ ...r, amount: Number(r.amount) }))

  return NextResponse.json({ data: { ...order, sickwChecks, mfnReturns, freeReplacements, refundsIssued } })
}
