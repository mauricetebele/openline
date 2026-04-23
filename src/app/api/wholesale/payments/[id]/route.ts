import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payment = await prisma.wholesalePayment.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, companyName: true } },
      allocations: {
        include: { order: { select: { id: true, orderNumber: true, invoiceNumber: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(payment)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.wholesalePayment.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { paymentDate, method, reference, memo } = body

  const payment = await prisma.wholesalePayment.update({
    where: { id: params.id },
    data: {
      ...(paymentDate !== undefined && { paymentDate: new Date(paymentDate) }),
      ...(method !== undefined && { method }),
      ...(reference !== undefined && { reference: reference?.trim() || null }),
      ...(memo !== undefined && { memo: memo?.trim() || null }),
    },
    include: {
      customer: { select: { id: true, companyName: true } },
      allocations: {
        include: { order: { select: { id: true, orderNumber: true, invoiceNumber: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  return NextResponse.json(payment)
}
