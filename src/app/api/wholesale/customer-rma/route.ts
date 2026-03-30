/**
 * GET  /api/wholesale/customer-rma  — list all customer RMAs
 * POST /api/wholesale/customer-rma  — create a new serial-based customer RMA
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
    },
    orderBy: { createdAt: 'asc' as const },
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
          { serials: { some: { serialNumber: { contains: search, mode: 'insensitive' } } } },
        ],
      } : {}),
    },
    include: INCLUDE,
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ data: rmas })
}

interface SerialInput {
  inventorySerialId: string
  returnReason: string
  salePrice?: number | null
  salesOrderId?: string | null
  soldAt?: string | null
  notes?: string | null
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    customerId: string
    reason?: string
    notes?: string
    serials: SerialInput[]
  }

  if (!body.customerId) return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
  if (!body.serials?.length) return NextResponse.json({ error: 'At least one serial is required' }, { status: 400 })

  // Auto-generate RMA number
  const count = await prisma.customerRMA.count()
  const rmaNumber = `CRMA-${String(count + 1).padStart(4, '0')}`

  // Look up serial details for denormalization
  const serialIds = body.serials.map(s => s.inventorySerialId)
  const inventorySerials = await prisma.inventorySerial.findMany({
    where: { id: { in: serialIds } },
    select: { id: true, serialNumber: true, productId: true, gradeId: true },
  })
  const serialMap = new Map(inventorySerials.map(s => [s.id, s]))

  // Compute credit amount from sale prices
  const creditAmount = body.serials.reduce((sum, s) => sum + (s.salePrice ?? 0), 0)

  const rma = await prisma.customerRMA.create({
    data: {
      rmaNumber,
      customerId: body.customerId,
      reason: body.reason?.trim() || null,
      notes: body.notes?.trim() || null,
      creditAmount: creditAmount || null,
      serials: {
        create: body.serials.map(s => {
          const inv = serialMap.get(s.inventorySerialId)
          return {
            inventorySerialId: s.inventorySerialId,
            productId: inv?.productId ?? '',
            gradeId: inv?.gradeId ?? null,
            serialNumber: inv?.serialNumber ?? '',
            salePrice: s.salePrice ?? null,
            salesOrderId: s.salesOrderId ?? null,
            soldAt: s.soldAt ? new Date(s.soldAt) : null,
            returnReason: s.returnReason,
            notes: s.notes?.trim() || null,
          }
        }),
      },
    },
    include: INCLUDE,
  })

  return NextResponse.json(rma, { status: 201 })
}
