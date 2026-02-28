import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { differenceInDays } from 'date-fns'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orders = await prisma.salesOrder.findMany({
    where: {
      status: { in: ['INVOICED', 'PARTIALLY_PAID'] },
      balance: { gt: 0 },
    },
    include: {
      customer: { select: { id: true, companyName: true } },
    },
  })

  const today = new Date()

  // Group by customer
  const customerMap = new Map<string, {
    customerId: string
    companyName: string
    current: number
    days1_30: number
    days31_60: number
    days61_90: number
    days91plus: number
    total: number
  }>()

  for (const order of orders) {
    const balance = Number(order.balance)
    const due     = order.dueDate ? new Date(order.dueDate) : today
    const daysLate = differenceInDays(today, due)

    const cid = order.customer.id
    if (!customerMap.has(cid)) {
      customerMap.set(cid, {
        customerId: cid,
        companyName: order.customer.companyName,
        current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days91plus: 0, total: 0,
      })
    }
    const row = customerMap.get(cid)!
    row.total += balance

    if (daysLate <= 0)       row.current  += balance
    else if (daysLate <= 30) row.days1_30  += balance
    else if (daysLate <= 60) row.days31_60 += balance
    else if (daysLate <= 90) row.days61_90 += balance
    else                     row.days91plus += balance
  }

  const rows = Array.from(customerMap.values())
    .sort((a, b) => a.companyName.localeCompare(b.companyName))

  const totals = rows.reduce(
    (acc, r) => ({
      current:   acc.current   + r.current,
      days1_30:  acc.days1_30  + r.days1_30,
      days31_60: acc.days31_60 + r.days31_60,
      days61_90: acc.days61_90 + r.days61_90,
      days91plus: acc.days91plus + r.days91plus,
      total:     acc.total     + r.total,
    }),
    { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days91plus: 0, total: 0 },
  )

  return NextResponse.json({ data: rows, totals })
}
