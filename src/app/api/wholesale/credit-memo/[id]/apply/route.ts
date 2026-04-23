import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { allocations } = body as { allocations: { orderId: string; amount: number }[] }

  if (!allocations || !Array.isArray(allocations) || allocations.length === 0) {
    return NextResponse.json({ error: 'At least one allocation is required' }, { status: 400 })
  }

  // Validate amounts are positive
  for (const a of allocations) {
    if (!a.orderId || typeof a.amount !== 'number' || a.amount <= 0) {
      return NextResponse.json({ error: 'Each allocation must have a valid orderId and positive amount' }, { status: 400 })
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const cm = await tx.wholesaleCreditMemo.findUnique({ where: { id } })
      if (!cm) throw new Error('Credit memo not found')

      const unallocated = Number(cm.unallocated)
      if (unallocated <= 0) throw new Error('Credit memo has no unallocated balance')

      const totalRequested = allocations.reduce((s, a) => s + a.amount, 0)
      if (totalRequested > unallocated + 0.005) {
        throw new Error(`Allocations ($${totalRequested.toFixed(2)}) exceed unallocated balance ($${unallocated.toFixed(2)})`)
      }

      // Create allocations and update orders
      for (const alloc of allocations) {
        const order = await tx.salesOrder.findUnique({ where: { id: alloc.orderId } })
        if (!order) throw new Error(`Order ${alloc.orderId} not found`)
        if (order.customerId !== cm.customerId) throw new Error('Order does not belong to credit memo customer')

        const orderBalance = Number(order.balance)
        if (alloc.amount > orderBalance + 0.005) {
          throw new Error(`Allocation $${alloc.amount.toFixed(2)} exceeds order ${order.orderNumber} balance $${orderBalance.toFixed(2)}`)
        }

        await tx.creditMemoAllocation.create({
          data: { creditMemoId: cm.id, orderId: alloc.orderId, amount: alloc.amount },
        })

        const newPaid = Number(order.paidAmount) + alloc.amount
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
      }

      // Update credit memo unallocated and status
      const newUnallocated = Math.max(0, unallocated - totalRequested)
      const newStatus = newUnallocated <= 0.005 ? 'APPLIED' : 'PARTIALLY_APPLIED'

      return tx.wholesaleCreditMemo.update({
        where: { id: cm.id },
        data: { unallocated: newUnallocated, status: newStatus },
        include: {
          customer: { select: { id: true, companyName: true } },
          rma: { select: { id: true, rmaNumber: true } },
          allocations: { include: { order: { select: { id: true, orderNumber: true } } } },
        },
      })
    })

    return NextResponse.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to apply credit'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
