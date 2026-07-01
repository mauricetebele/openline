import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search')?.trim()

  const where: Record<string, unknown> = {}
  if (search) {
    where.OR = [
      { rmaNumber: { contains: search, mode: 'insensitive' } },
      { orderRef: { contains: search, mode: 'insensitive' } },
      { vendor: { name: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const rmas = await prisma.legacyRMA.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          serials: { select: { id: true } },
        },
      },
    },
  })

  return NextResponse.json({ data: rmas })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { orderRef, vendorId, notes } = body

  if (!orderRef?.trim()) {
    return NextResponse.json({ error: 'Order reference is required' }, { status: 400 })
  }

  // Auto-generate rmaNumber: LRMA-0001
  const last = await prisma.legacyRMA.findFirst({ orderBy: { createdAt: 'desc' } })
  let nextNum = 1
  if (last) {
    const match = last.rmaNumber.match(/LRMA-(\d+)/)
    if (match) nextNum = parseInt(match[1], 10) + 1
  }
  const rmaNumber = `LRMA-${String(nextNum).padStart(4, '0')}`

  const rma = await prisma.legacyRMA.create({
    data: {
      rmaNumber,
      orderRef: orderRef.trim(),
      vendorId: vendorId || null,
      notes: notes?.trim() || null,
    },
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      items: { include: { product: true, grade: true, vendor: true, serials: true } },
    },
  })

  return NextResponse.json(rma, { status: 201 })
}
