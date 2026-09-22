/**
 * GET    /api/repair-orders/[id]  — full order: vendor, items (serial→SKU/model), tracking
 * PATCH  /api/repair-orders/[id]  — update status / notes
 * DELETE /api/repair-orders/[id]  — delete (only DRAFT)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { recordRepairShipment } from '@/lib/repair-location'

export const dynamic = 'force-dynamic'

const STATUSES = ['DRAFT', 'SHIPPED_OUT', 'AT_VENDOR', 'RETURNED', 'COMPLETED', 'CANCELLED']

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const order = await prisma.repairOrder.findUnique({
    where: { id: params.id },
    include: {
      vendor: true,
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          repairType: { select: { id: true, name: true } },
          inventorySerial: {
            select: {
              id: true, serialNumber: true, status: true,
              product: { select: { sku: true, description: true } },
              grade: { select: { grade: true } },
              location: { select: { name: true } },
            },
          },
        },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'Repair order not found' }, { status: 404 })

  const items = order.items.map(it => ({
    id: it.id,
    serialId: it.inventorySerialId,
    serialNumber: it.inventorySerial.serialNumber,
    serialStatus: it.inventorySerial.status,
    sku: it.inventorySerial.product?.sku ?? null,
    model: it.inventorySerial.product?.description ?? null,
    grade: it.inventorySerial.grade?.grade ?? null,
    location: it.inventorySerial.location?.name ?? null,
    repairTypeId: it.repairTypeId,
    repairTypeName: it.repairType?.name ?? null,
    repairCost: it.repairCost != null ? Number(it.repairCost) : null,
    status: it.status,
    repairSummary: it.repairSummary,
  }))
  return NextResponse.json({
    id: order.id, orderNumber: order.orderNumber, status: order.status, notes: order.notes,
    vendor: order.vendor,
    outboundCarrier: order.outboundCarrier, outboundTracking: order.outboundTracking,
    inboundCarrier: order.inboundCarrier, inboundTracking: order.inboundTracking,
    createdAt: order.createdAt,
    items,
    totalCost: Math.round(items.reduce((s, i) => s + (i.repairCost ?? 0), 0) * 100) / 100,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (typeof b?.status === 'string' && STATUSES.includes(b.status)) data.status = b.status
  if ('notes' in b) data.notes = typeof b.notes === 'string' ? (b.notes.trim() || null) : null
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  const order = await prisma.repairOrder.update({ where: { id: params.id }, data }).catch(() => null)
  if (!order) return NextResponse.json({ error: 'Repair order not found' }, { status: 404 })

  // Status → SHIPPED_OUT moves units into the vendor's mapped repair location and
  // logs the shipment; → RETURNED logs the return. Best-effort; idempotent.
  let relocation: { moved: number; logged: number; locationName: string | null } | null = null
  if (data.status === 'SHIPPED_OUT' || data.status === 'RETURNED') {
    try { relocation = await recordRepairShipment(params.id, data.status === 'SHIPPED_OUT' ? 'outbound' : 'inbound', user.dbId) }
    catch (e) { console.error('[repair-order PATCH] record repair shipment failed', e) }
  }
  return NextResponse.json({ ...order, ...(relocation && (relocation.moved > 0 || relocation.logged > 0) ? { relocation } : {}) })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const order = await prisma.repairOrder.findUnique({ where: { id: params.id }, select: { status: true } })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (order.status !== 'DRAFT') return NextResponse.json({ error: 'Only draft repair orders can be deleted; cancel it instead.' }, { status: 409 })
  await prisma.repairOrder.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
