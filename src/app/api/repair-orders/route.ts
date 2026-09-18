/**
 * GET  /api/repair-orders  — list repair orders (with vendor + item/cost totals)
 * POST /api/repair-orders  — create a repair order { vendorId, notes? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orders = await prisma.repairOrder.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      vendor: { select: { companyName: true } },
      items: { select: { repairCost: true, status: true } },
    },
  })
  const data = orders.map(o => ({
    id: o.id, orderNumber: o.orderNumber, status: o.status, notes: o.notes,
    vendorName: o.vendor.companyName, createdAt: o.createdAt,
    outboundTracking: o.outboundTracking, inboundTracking: o.inboundTracking,
    itemCount: o.items.length,
    totalCost: Math.round(o.items.reduce((s, i) => s + (i.repairCost ? Number(i.repairCost) : 0), 0) * 100) / 100,
  }))
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const vendorId = typeof b?.vendorId === 'string' ? b.vendorId : ''
  if (!vendorId) return NextResponse.json({ error: 'Select a repair vendor' }, { status: 400 })
  const vendor = await prisma.repairVendor.findUnique({ where: { id: vendorId } })
  if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  const order = await prisma.repairOrder.create({
    data: { vendorId, notes: typeof b?.notes === 'string' ? b.notes.trim() || null : null },
  })
  return NextResponse.json(order, { status: 201 })
}
