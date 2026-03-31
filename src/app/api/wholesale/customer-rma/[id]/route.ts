/**
 * GET    /api/wholesale/customer-rma/[id]  — get single RMA
 * PATCH  /api/wholesale/customer-rma/[id]  — update status / fields
 * DELETE /api/wholesale/customer-rma/[id]  — delete unreceived RMA
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const INCLUDE = {
  customer: { select: { id: true, companyName: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, description: true } },
    },
  },
  serials: {
    include: {
      product: { select: { id: true, sku: true, description: true } },
      grade: { select: { id: true, grade: true } },
      inventorySerial: { select: { status: true, locationId: true } },
      receivedLocation: {
        select: { name: true, warehouse: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  creditMemo: {
    select: { id: true, memoNumber: true, total: true, createdAt: true },
  },
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.customerRMA.findUnique({ where: { id: params.id }, include: INCLUDE })
  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rma)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    status?: string
    notes?: string
    creditAmount?: number | null
  }

  const rma = await prisma.customerRMA.update({
    where: { id: params.id },
    data: {
      ...(body.status       ? { status: body.status as never } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.creditAmount !== undefined ? { creditAmount: body.creditAmount } : {}),
    },
    include: INCLUDE,
  })

  return NextResponse.json(rma)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.customerRMA.findUnique({
    where: { id: params.id },
    include: { serials: { where: { receivedAt: { not: null } }, select: { id: true }, take: 1 } },
  })

  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (rma.serials.length > 0) {
    return NextResponse.json(
      { error: 'Cannot delete RMA with received serials' },
      { status: 400 },
    )
  }

  await prisma.customerRMA.delete({ where: { id: params.id } })

  return NextResponse.json({ success: true })
}
