import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const memo = await prisma.wholesaleCreditMemo.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, companyName: true } },
      rma: { select: { id: true, rmaNumber: true } },
      allocations: {
        include: { order: { select: { id: true, orderNumber: true, invoiceNumber: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!memo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(memo)
}
