import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customer = await prisma.wholesaleCustomer.findUnique({
    where: { id: params.id },
    include: {
      addresses: true,
      salesOrders: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { items: true },
      },
      payments: {
        orderBy: { paymentDate: 'desc' },
        take: 10,
      },
    },
  })

  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Open balance = order balances - unallocated credit memo amounts
  const [orderBal, cmTotal, cmAllocated] = await Promise.all([
    prisma.salesOrder.aggregate({
      where: { customerId: params.id, status: { in: ['INVOICED', 'PARTIALLY_PAID'] } },
      _sum: { balance: true },
    }),
    prisma.wholesaleCreditMemo.aggregate({
      where: { customerId: params.id },
      _sum: { total: true },
    }),
    prisma.creditMemoAllocation.aggregate({
      where: { creditMemo: { customerId: params.id } },
      _sum: { amount: true },
    }),
  ])
  const unallocatedCredits = Number(cmTotal._sum.total ?? 0) - Number(cmAllocated._sum.amount ?? 0)
  const openBalance = Number(orderBal._sum.balance ?? 0) - unallocatedCredits

  return NextResponse.json({
    ...customer,
    openBalance,
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    companyName, contactName, phone, email, website,
    taxExempt, taxId, taxRate, creditLimit, paymentTerms,
    defaultDiscount, notes, active,
  } = body

  if (companyName !== undefined && !companyName?.trim()) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
  }

  const customer = await prisma.wholesaleCustomer.update({
    where: { id: params.id },
    data: {
      ...(companyName     !== undefined && { companyName:     companyName.trim() }),
      ...(contactName     !== undefined && { contactName:     contactName?.trim() || null }),
      ...(phone           !== undefined && { phone:           phone?.trim() || null }),
      ...(email           !== undefined && { email:           email?.trim() || null }),
      ...(website         !== undefined && { website:         website?.trim() || null }),
      ...(taxExempt       !== undefined && { taxExempt }),
      ...(taxId           !== undefined && { taxId:           taxId?.trim() || null }),
      ...(taxRate         !== undefined && { taxRate }),
      ...(creditLimit     !== undefined && { creditLimit:     creditLimit }),
      ...(paymentTerms    !== undefined && { paymentTerms }),
      ...(defaultDiscount !== undefined && { defaultDiscount }),
      ...(notes           !== undefined && { notes:           notes?.trim() || null }),
      ...(active          !== undefined && { active }),
    },
    include: { addresses: true },
  })

  return NextResponse.json(customer)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orderCount = await prisma.salesOrder.count({ where: { customerId: params.id } })
  if (orderCount > 0) {
    return NextResponse.json({ error: 'Cannot delete customer with existing orders' }, { status: 400 })
  }

  await prisma.wholesaleCustomer.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
