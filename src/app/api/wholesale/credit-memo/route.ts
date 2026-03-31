import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customerId = req.nextUrl.searchParams.get('customerId')
  const where = customerId ? { customerId } : {}

  const memos = await prisma.wholesaleCreditMemo.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      customer: { select: { id: true, companyName: true } },
      rma: { select: { id: true, rmaNumber: true } },
      allocations: { include: { order: { select: { id: true, orderNumber: true } } } },
    },
  })

  return NextResponse.json({ data: memos })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { rmaId, restockingFee = 0, restockingReason, notes } = body

  if (!rmaId) {
    return NextResponse.json({ error: 'rmaId is required' }, { status: 400 })
  }

  const fee = Number(restockingFee)
  if (fee < 0) return NextResponse.json({ error: 'Restocking fee cannot be negative' }, { status: 400 })
  if (fee > 0 && !restockingReason?.trim()) {
    return NextResponse.json({ error: 'Restocking reason is required when fee > 0' }, { status: 400 })
  }

  const memo = await prisma.$transaction(async (tx) => {
    // Validate RMA
    const rma = await tx.customerRMA.findUnique({
      where: { id: rmaId },
      include: {
        serials: { where: { receivedAt: { not: null } } },
        creditMemo: { select: { id: true } },
      },
    })

    if (!rma) throw new Error('RMA not found')
    if (!['RECEIVED', 'INSPECTED'].includes(rma.status)) {
      throw new Error('RMA must be in RECEIVED or INSPECTED status')
    }
    if (rma.creditMemo) throw new Error('Credit memo already exists for this RMA')
    if (rma.serials.length === 0) throw new Error('No received serials on this RMA')

    // Calculate subtotal from received serials' salePrice
    const subtotal = rma.serials.reduce((sum, s) => sum + Number(s.salePrice ?? 0), 0)
    if (subtotal <= 0) throw new Error('No sale prices on received serials')

    const total = Math.max(0, subtotal - fee)

    // Auto-generate memo number (CM-0001 pattern)
    const lastMemo = await tx.wholesaleCreditMemo.findFirst({ orderBy: { memoNumber: 'desc' } })
    let nextNum = 1
    if (lastMemo) {
      const match = lastMemo.memoNumber.match(/CM-?(\d+)/)
      if (match) nextNum = parseInt(match[1]) + 1
    }
    const memoNumber = `CM-${String(nextNum).padStart(4, '0')}`

    // Create credit memo
    const cm = await tx.wholesaleCreditMemo.create({
      data: {
        memoNumber,
        customerId: rma.customerId,
        rmaId: rma.id,
        subtotal,
        restockingFee: fee,
        restockingReason: fee > 0 ? restockingReason?.trim() : null,
        total,
        notes: notes?.trim() || null,
      },
    })

    // FIFO-allocate credit to oldest unpaid invoices
    let remaining = total
    const openOrders = await tx.salesOrder.findMany({
      where: {
        customerId: rma.customerId,
        status: { in: ['INVOICED', 'PARTIALLY_PAID'] },
        balance: { gt: 0 },
      },
      orderBy: { dueDate: 'asc' },
    })

    for (const order of openOrders) {
      if (remaining <= 0) break
      const orderBalance = Number(order.balance)
      const allocAmt = Math.min(orderBalance, remaining)

      await tx.creditMemoAllocation.create({
        data: { creditMemoId: cm.id, orderId: order.id, amount: allocAmt },
      })

      const newPaid = Number(order.paidAmount) + allocAmt
      const newBalance = Number(order.total) - newPaid
      let newStatus: string = order.status

      if (newBalance <= 0.005) {
        newStatus = 'PAID'
      } else if (newPaid > 0) {
        newStatus = 'PARTIALLY_PAID'
      }

      await tx.salesOrder.update({
        where: { id: order.id },
        data: {
          paidAmount: newPaid,
          balance: Math.max(0, newBalance),
          status: newStatus as never,
        },
      })

      remaining -= allocAmt
    }

    // Update RMA status to REFUNDED and set creditAmount
    await tx.customerRMA.update({
      where: { id: rma.id },
      data: { status: 'REFUNDED', creditAmount: total },
    })

    return tx.wholesaleCreditMemo.findUnique({
      where: { id: cm.id },
      include: {
        customer: { select: { id: true, companyName: true } },
        rma: { select: { id: true, rmaNumber: true } },
        allocations: { include: { order: { select: { id: true, orderNumber: true } } } },
      },
    })
  })

  return NextResponse.json(memo, { status: 201 })
}
