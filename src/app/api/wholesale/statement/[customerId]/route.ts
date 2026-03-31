import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { customerId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customer = await prisma.wholesaleCustomer.findUnique({
    where: { id: params.customerId },
    select: { id: true, companyName: true, contactName: true, email: true, phone: true },
  })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [orders, payments, creditMemos] = await Promise.all([
    prisma.salesOrder.findMany({
      where: {
        customerId: params.customerId,
        status: { in: ['INVOICED', 'PARTIALLY_PAID', 'PAID'] },
      },
      orderBy: { orderDate: 'asc' },
    }),
    prisma.wholesalePayment.findMany({
      where: { customerId: params.customerId },
      orderBy: { paymentDate: 'asc' },
    }),
    prisma.wholesaleCreditMemo.findMany({
      where: { customerId: params.customerId },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  // Build chronological statement lines
  type StatementLine = {
    date: Date
    type: 'INVOICE' | 'PAYMENT' | 'CREDIT_MEMO'
    reference: string
    charges: number
    credits: number
    balance: number
  }

  const lines: StatementLine[] = []

  // Merge invoices + payments + credit memos into timeline
  const events: Array<{ date: Date; line: Omit<StatementLine, 'balance'> }> = [
    ...orders.map((o) => ({
      date: o.orderDate,
      line: {
        date:      o.orderDate,
        type:      'INVOICE' as const,
        reference: o.orderNumber,
        charges:   Number(o.total),
        credits:   Number(o.paidAmount),
      },
    })),
    ...payments.map((p) => ({
      date: p.paymentDate,
      line: {
        date:      p.paymentDate,
        type:      'PAYMENT' as const,
        reference: p.reference ?? `PMT-${p.id.slice(-6).toUpperCase()}`,
        charges:   0,
        credits:   Number(p.amount),
      },
    })),
    ...creditMemos.map((cm) => ({
      date: cm.createdAt,
      line: {
        date:      cm.createdAt,
        type:      'CREDIT_MEMO' as const,
        reference: cm.memoNumber,
        charges:   0,
        credits:   Number(cm.total),
      },
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime())

  let runningBalance = 0
  for (const event of events) {
    if (event.line.type === 'INVOICE') {
      runningBalance += event.line.charges - event.line.credits
    } else {
      runningBalance -= event.line.credits
    }
    lines.push({ ...event.line, balance: runningBalance })
  }

  const openBalance = await prisma.salesOrder.aggregate({
    where: {
      customerId: params.customerId,
      status: { in: ['INVOICED', 'PARTIALLY_PAID'] },
    },
    _sum: { balance: true },
  })

  return NextResponse.json({
    customer,
    lines: lines.reverse(),
    openBalance: Number(openBalance._sum.balance ?? 0),
  })
}
