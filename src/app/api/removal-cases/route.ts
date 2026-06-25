/**
 * GET  /api/removal-cases — Paginated list with search
 * POST /api/removal-cases — Create a new removal case
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? '25')))
  const skip = (page - 1) * pageSize

  const where: Prisma.FbaRemovalCaseWhereInput = {}

  const search = searchParams.get('search')?.trim()
  if (search) {
    where.OR = [
      { removalOrderId: { contains: search, mode: 'insensitive' } },
      { trackingNumber: { contains: search, mode: 'insensitive' } },
      { sellerSku: { contains: search, mode: 'insensitive' } },
      { fnsku: { contains: search, mode: 'insensitive' } },
      { note: { contains: search, mode: 'insensitive' } },
      { lpnNumber: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [total, cases] = await Promise.all([
    prisma.fbaRemovalCase.count({ where }),
    prisma.fbaRemovalCase.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { name: true } },
      },
    }),
  ])

  return NextResponse.json({
    data: cases,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    removalOrderId,
    trackingNumber,
    lpnNumber,
    fnsku,
    sellerSku,
    productTitle,
    note,
    removalShipmentId,
    removalShipmentItemId,
  } = body

  if (!removalOrderId || !trackingNumber || !fnsku || !sellerSku) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const created = await prisma.fbaRemovalCase.create({
    data: {
      removalOrderId,
      trackingNumber,
      lpnNumber: lpnNumber || null,
      fnsku,
      sellerSku,
      productTitle: productTitle || null,
      note: note || null,
      removalShipmentId: removalShipmentId || null,
      removalShipmentItemId: removalShipmentItemId || null,
      createdById: user.id,
    },
  })

  return NextResponse.json(created, { status: 201 })
}
