import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { customerId, amount, memo, description } = body

  if (!customerId) return NextResponse.json({ error: 'customerId is required' }, { status: 400 })

  const amt = Number(amount)
  if (!amt || amt <= 0) return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })

  const customer = await prisma.wholesaleCustomer.findUnique({ where: { id: customerId } })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const cm = await prisma.$transaction(async (tx) => {
    // Auto-generate memo number (CM-0001 pattern)
    const lastMemo = await tx.wholesaleCreditMemo.findFirst({ orderBy: { memoNumber: 'desc' } })
    let nextNum = 1
    if (lastMemo) {
      const match = lastMemo.memoNumber.match(/CM-?(\d+)/)
      if (match) nextNum = parseInt(match[1]) + 1
    }
    const memoNumber = `CM-${String(nextNum).padStart(4, '0')}`

    return tx.wholesaleCreditMemo.create({
      data: {
        memoNumber,
        customerId,
        rmaId: null,
        subtotal: amt,
        restockingFee: 0,
        total: amt,
        status: 'UNAPPLIED',
        unallocated: amt,
        memo: memo?.trim() || null,
        description: description?.trim() || null,
      },
      include: {
        customer: { select: { id: true, companyName: true } },
        rma: { select: { id: true, rmaNumber: true } },
        allocations: { include: { order: { select: { id: true, orderNumber: true } } } },
      },
    })
  })

  return NextResponse.json(cm, { status: 201 })
}
