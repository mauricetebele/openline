/**
 * GET   /api/wholesale/customer-rma/[id]  — get single RMA
 * PATCH /api/wholesale/customer-rma/[id]  — update status / fields
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
