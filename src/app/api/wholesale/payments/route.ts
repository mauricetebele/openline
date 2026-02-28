import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const customerId = searchParams.get('customerId')

  const where = customerId ? { customerId } : {}

  const payments = await prisma.wholesalePayment.findMany({
    where,
    orderBy: { paymentDate: 'desc' },
    include: {
      allocations: { include: { order: { select: { id: true, orderNumber: true } } } },
      customer:    { select: { id: true, companyName: true } },
    },
  })

  return NextResponse.json({ data: payments })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { customerId, paymentDate, amount, method, reference, memo, allocations } = body

  if (!customerId || !amount || !method) {
    return NextResponse.json({ error: 'customerId, amount, and method are required' }, { status: 400 })
  }

  const payAmount = Number(amount)
  if (payAmount <= 0) return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.wholesalePayment.create({
      data: {
        customerId,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        amount:      payAmount,
        method,
        reference:   reference?.trim() || null,
        memo:        memo?.trim() || null,
        unallocated: payAmount,
      },
    })

    let remaining = payAmount
    const allocationRecords: { orderId: string; allocatedAmt: number }[] = []

    if (Array.isArray(allocations) && allocations.length > 0) {
      // Manual allocation
      for (const alloc of allocations) {
        const allocAmt = Number(alloc.amount)
        if (allocAmt <= 0) continue
        if (allocAmt > remaining) {
          throw new Error('Allocation amount exceeds payment amount')
        }
        allocationRecords.push({ orderId: alloc.orderId, allocatedAmt: allocAmt })
        remaining -= allocAmt
      }
    } else {
      // FIFO: find oldest unpaid invoices
      const openOrders = await tx.salesOrder.findMany({
        where: {
          customerId,
          status: { in: ['INVOICED', 'PARTIALLY_PAID'] },
          balance: { gt: 0 },
        },
        orderBy: { dueDate: 'asc' },
      })

      for (const order of openOrders) {
        if (remaining <= 0) break
        const orderBalance = Number(order.balance)
        const allocAmt = Math.min(orderBalance, remaining)
        allocationRecords.push({ orderId: order.id, allocatedAmt: allocAmt })
        remaining -= allocAmt
      }
    }

    // Create allocations and update orders
    for (const { orderId, allocatedAmt } of allocationRecords) {
      await tx.paymentAllocation.create({
        data: { paymentId: p.id, orderId, amount: allocatedAmt },
      })

      const order = await tx.salesOrder.findUnique({ where: { id: orderId } })
      if (!order) continue

      const newPaid    = Number(order.paidAmount) + allocatedAmt
      const newBalance = Number(order.total) - newPaid
      let newStatus: string = order.status

      if (newBalance <= 0.005) {
        newStatus = 'PAID'
      } else if (newPaid > 0) {
        newStatus = 'PARTIALLY_PAID'
      }

      await tx.salesOrder.update({
        where: { id: orderId },
        data: {
          paidAmount: newPaid,
          balance:    Math.max(0, newBalance),
          status:     newStatus as never,
        },
      })
    }

    // Update unallocated
    await tx.wholesalePayment.update({
      where: { id: p.id },
      data:  { unallocated: Math.max(0, remaining) },
    })

    return tx.wholesalePayment.findUnique({
      where: { id: p.id },
      include: { allocations: { include: { order: true } } },
    })
  })

  return NextResponse.json(payment, { status: 201 })
}
