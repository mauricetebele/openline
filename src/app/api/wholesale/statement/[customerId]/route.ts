import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  req: NextRequest,
  { params }: { params: { customerId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const view = req.nextUrl.searchParams.get('view') // 'open' or null (activity)

  const customer = await prisma.wholesaleCustomer.findUnique({
    where: { id: params.customerId },
    select: { id: true, companyName: true, contactName: true, email: true, phone: true },
  })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // For open view, only fetch transactions that are not fully closed
  const orderStatusFilter = view === 'open'
    ? { in: ['INVOICED', 'PARTIALLY_PAID'] }
    : { in: ['INVOICED', 'PARTIALLY_PAID', 'PAID'] }

  const [orders, payments, creditMemos] = await Promise.all([
    prisma.salesOrder.findMany({
      where: {
        customerId: params.customerId,
        status: orderStatusFilter,
      },
      orderBy: { orderDate: 'asc' },
    }),
    prisma.wholesalePayment.findMany({
      where: {
        customerId: params.customerId,
        ...(view === 'open' ? { unallocated: { gt: 0 } } : {}),
      },
      orderBy: { paymentDate: 'asc' },
    }),
    prisma.wholesaleCreditMemo.findMany({
      where: {
        customerId: params.customerId,
        ...(view === 'open' ? { unallocated: { gt: 0 } } : {}),
      },
      include: { rma: { select: { rmaNumber: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  // Build chronological statement lines
  type StatementLine = {
    date: Date
    type: 'INVOICE' | 'PAYMENT' | 'CREDIT_MEMO'
    reference: string
    invoiceNumber: string | null
    charges: number
    credits: number
    balance: number
    paymentId?: string
  }

  const lines: StatementLine[] = []

  // Merge invoices + payments + credit memos into timeline
  const events: Array<{ date: Date; line: Omit<StatementLine, 'balance'> }> = [
    ...orders.map((o) => ({
      date: o.orderDate,
      line: {
        date:           o.orderDate,
        type:           'INVOICE' as const,
        reference:      o.orderNumber,
        invoiceNumber:  o.invoiceNumber ?? null,
        charges:        Number(o.total),
        credits:        0,
      },
    })),
    ...payments.map((p) => ({
      date: p.paymentDate,
      line: {
        date:           p.paymentDate,
        type:           'PAYMENT' as const,
        reference:      p.reference || '',
        invoiceNumber:  p.paymentNumber || null,
        charges:        0,
        credits:        Number(p.amount),
        paymentId:      p.id,
      },
    })),
    ...creditMemos.map((cm) => ({
      date: cm.createdAt,
      line: {
        date:           cm.createdAt,
        type:           'CREDIT_MEMO' as const,
        reference:      cm.rma?.rmaNumber ?? cm.memo ?? '',
        invoiceNumber:  cm.memoNumber,
        charges:        0,
        credits:        Number(cm.total),
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

  // Open balance = final running balance (already accounts for invoices, payments, AND credit memos)
  const openBalance = lines.length > 0 ? lines[lines.length - 1].balance : 0

  return NextResponse.json({
    customer,
    lines: lines.reverse(),
    openBalance,
  })
}
