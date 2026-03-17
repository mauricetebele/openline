import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search')?.trim()
  const status = searchParams.get('status')

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (search) {
    where.OR = [
      { rmaNumber: { contains: search, mode: 'insensitive' } },
      { vendor: { name: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const rmas = await prisma.vendorRMA.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      items: {
        select: {
          quantity: true,
          unitCost: true,
          serials: { select: { scannedOutAt: true } },
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
  const { vendorId, notes } = body

  if (!vendorId) return NextResponse.json({ error: 'Vendor is required' }, { status: 400 })

  // Auto-generate rmaNumber: VRMA-0001
  const last = await prisma.vendorRMA.findFirst({ orderBy: { createdAt: 'desc' } })
  let nextNum = 1
  if (last) {
    const match = last.rmaNumber.match(/VRMA-(\d+)/)
    if (match) nextNum = parseInt(match[1], 10) + 1
  }
  const rmaNumber = `VRMA-${String(nextNum).padStart(4, '0')}`

  const rma = await prisma.vendorRMA.create({
    data: { rmaNumber, vendorId, notes: notes?.trim() || null },
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      items: { include: { product: true, serials: true } },
    },
  })

  return NextResponse.json(rma, { status: 201 })
}
