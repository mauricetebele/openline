import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const searchParams = req.nextUrl.searchParams
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get('pageSize') ?? '50', 10)))
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const search = searchParams.get('search')?.trim().toLowerCase() || ''

  const dateFilter: Record<string, Date> = {}
  if (startDate) dateFilter.gte = new Date(startDate + 'T00:00:00Z')
  if (endDate) dateFilter.lte = new Date(endDate + 'T23:59:59.999Z')

  const conditions: Record<string, unknown>[] = []

  if (startDate || endDate) {
    conditions.push({ purchaseOrder: { date: dateFilter } })
  }

  if (search) {
    const poNumSearch = parseInt(search, 10)
    conditions.push({
      OR: [
        { product: { sku: { contains: search, mode: 'insensitive' } } },
        { product: { description: { contains: search, mode: 'insensitive' } } },
        ...(Number.isFinite(poNumSearch) ? [{ purchaseOrder: { poNumber: poNumSearch } }] : []),
      ],
    })
  }

  const where = conditions.length > 0 ? { AND: conditions } : {}

  const [rows, totalCount] = await Promise.all([
    prisma.purchaseOrderLine.findMany({
      where,
      include: {
        purchaseOrder: { select: { poNumber: true, date: true } },
        product: { select: { sku: true, description: true } },
        grade: { select: { grade: true } },
        costCode: { select: { id: true, name: true, amount: true } },
      },
      orderBy: { purchaseOrder: { date: 'desc' } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.purchaseOrderLine.count({ where }),
  ])

  const mapped = rows.map((r) => ({
    id: r.id,
    poNumber: r.purchaseOrder.poNumber,
    sku: r.product.sku,
    description: r.product.description,
    grade: r.grade?.grade ?? null,
    qty: r.qty,
    unitCost: Number(r.unitCost),
    costCodeId: r.costCode?.id ?? null,
    costCodeName: r.costCode?.name ?? null,
    costCodeAmount: r.costCode ? Number(r.costCode.amount) : null,
    date: r.purchaseOrder.date.toISOString(),
  }))

  return NextResponse.json({ rows: mapped, totalCount, page, pageSize })
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { lineIds, costCodeId } = body

  if (!Array.isArray(lineIds) || lineIds.length === 0) {
    return NextResponse.json({ error: 'lineIds is required' }, { status: 400 })
  }

  if (costCodeId !== null && costCodeId !== undefined) {
    const cc = await prisma.costCode.findUnique({ where: { id: costCodeId } })
    if (!cc) return NextResponse.json({ error: 'Cost code not found' }, { status: 404 })
  }

  const result = await prisma.purchaseOrderLine.updateMany({
    where: { id: { in: lineIds } },
    data: { costCodeId: costCodeId ?? null },
  })

  return NextResponse.json({ updated: result.count })
}
