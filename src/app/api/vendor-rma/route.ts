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
          id: true,
          quantity: true,
          unitCost: true,
          serials: { select: { serialNumber: true, scannedOutAt: true } },
        },
      },
    },
  })

  // Enrich with live PO costs per serial (instead of stale snapshot)
  const allSerials = rmas.flatMap(r => r.items.flatMap(i => i.serials.map(s => s.serialNumber)))
  const liveCostMap = new Map<string, number>()
  if (allSerials.length > 0) {
    const inventorySerials = await prisma.inventorySerial.findMany({
      where: { serialNumber: { in: allSerials } },
      select: {
        serialNumber: true,
        unitCost: true,
        receiptLine: {
          select: { purchaseOrderLine: { select: { unitCost: true } } },
        },
      },
    })
    for (const s of inventorySerials) {
      const cost = s.receiptLine?.purchaseOrderLine?.unitCost != null
        ? Number(s.receiptLine.purchaseOrderLine.unitCost)
        : (s.unitCost != null ? Number(s.unitCost) : null)
      if (cost != null) liveCostMap.set(s.serialNumber, cost)
    }
  }

  const enrichedRmas = rmas.map(rma => ({
    ...rma,
    items: rma.items.map(item => {
      if (item.serials.length > 0) {
        const costs = item.serials.map(s => liveCostMap.get(s.serialNumber)).filter((c): c is number => c != null)
        const liveUnitCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null
        return { ...item, unitCost: liveUnitCost != null ? String(liveUnitCost) : item.unitCost }
      }
      return item
    }),
  }))

  return NextResponse.json({ data: enrichedRmas })
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
