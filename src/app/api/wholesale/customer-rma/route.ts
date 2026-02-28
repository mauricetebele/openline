/**
 * GET  /api/wholesale/customer-rma  — list all customer RMAs
 * POST /api/wholesale/customer-rma  — create a new customer RMA
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

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search     = searchParams.get('search')?.trim()
  const statusFilter = searchParams.get('status')?.trim()

  const rmas = await prisma.customerRMA.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter as never } : {}),
      ...(search ? {
        OR: [
          { rmaNumber: { contains: search, mode: 'insensitive' } },
          { customer: { companyName: { contains: search, mode: 'insensitive' } } },
          { reason:    { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    },
    include: INCLUDE,
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ data: rmas })
}

interface ItemInput {
  productId: string
  quantity: number
  unitPrice?: number | null
  condition?: string | null
  notes?: string | null
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    customerId: string
    reason: string
    notes?: string
    creditAmount?: number | null
    items: ItemInput[]
  }

  if (!body.customerId) return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
  if (!body.reason?.trim()) return NextResponse.json({ error: 'reason is required' }, { status: 400 })
  if (!body.items?.length) return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })

  // Auto-generate RMA number
  const count = await prisma.customerRMA.count()
  const rmaNumber = `CRMA-${String(count + 1).padStart(4, '0')}`

  const rma = await prisma.customerRMA.create({
    data: {
      rmaNumber,
      customerId:  body.customerId,
      reason:      body.reason.trim(),
      notes:       body.notes?.trim() || null,
      creditAmount: body.creditAmount ?? null,
      items: {
        create: body.items.map(i => ({
          productId: i.productId,
          quantity:  Math.max(1, i.quantity),
          unitPrice: i.unitPrice ?? null,
          condition: i.condition?.trim() || null,
          notes:     i.notes?.trim() || null,
        })),
      },
    },
    include: INCLUDE,
  })

  return NextResponse.json(rma, { status: 201 })
}
