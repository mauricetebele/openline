/**
 * POST   /api/repair-orders/[id]/items  — add IN-STOCK serials { serials: string[] }
 * PATCH  /api/repair-orders/[id]/items  — assign type/cost OR record per-IMEI outcome
 *          assign : { itemIds: string[], repairTypeId?, repairCost? }
 *          outcome: { itemIds: string[], status: 'REPAIRED'|'REFUSED', repairSummary? }
 * DELETE /api/repair-orders/[id]/items  — remove { itemIds: string[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function order(id: string) { return prisma.repairOrder.findUnique({ where: { id }, select: { id: true } }) }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await order(params.id))) return NextResponse.json({ error: 'Repair order not found' }, { status: 404 })

  const b = await req.json().catch(() => ({}))
  const raw: string[] = Array.isArray(b?.serials) ? b.serials
    : typeof b?.serials === 'string' ? b.serials.split(/[\n\r,\t]+/) : []
  const serials = Array.from(new Set(raw.map(s => String(s).trim()).filter(Boolean)))
  if (serials.length === 0) return NextResponse.json({ error: 'No serials provided' }, { status: 400 })

  const found = await prisma.inventorySerial.findMany({
    where: { serialNumber: { in: serials } },
    select: { id: true, serialNumber: true, status: true },
  })
  const bySerial = new Map(found.map(s => [s.serialNumber.toUpperCase(), s]))
  const existing = new Set((await prisma.repairOrderItem.findMany({
    where: { repairOrderId: params.id }, select: { inventorySerialId: true },
  })).map(i => i.inventorySerialId))

  let added = 0
  const errors: string[] = []
  const toCreate: string[] = []
  for (const sn of serials) {
    const rec = bySerial.get(sn.toUpperCase())
    if (!rec) { errors.push(`${sn}: not found`); continue }
    if (rec.status !== 'IN_STOCK') { errors.push(`${sn}: not in stock (${rec.status})`); continue }
    if (existing.has(rec.id) || toCreate.includes(rec.id)) { errors.push(`${sn}: already on this order`); continue }
    toCreate.push(rec.id)
  }
  if (toCreate.length > 0) {
    await prisma.repairOrderItem.createMany({
      data: toCreate.map(inventorySerialId => ({ repairOrderId: params.id, inventorySerialId })),
      skipDuplicates: true,
    })
    added = toCreate.length
  }
  return NextResponse.json({ added, errors })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const itemIds: string[] = Array.isArray(b?.itemIds) ? b.itemIds.filter((x: unknown) => typeof x === 'string') : []
  if (itemIds.length === 0) return NextResponse.json({ error: 'No items selected' }, { status: 400 })

  const where = { id: { in: itemIds }, repairOrderId: params.id }

  // Outcome mode (per-IMEI repaired/refused).
  if (b?.status === 'REPAIRED' || b?.status === 'REFUSED' || b?.status === 'PENDING') {
    const data: Record<string, unknown> = { status: b.status }
    if ('repairSummary' in b) data.repairSummary = typeof b.repairSummary === 'string' ? (b.repairSummary.trim() || null) : null
    // A refused unit incurs no repair cost.
    if (b.status === 'REFUSED') data.repairCost = null
    const res = await prisma.repairOrderItem.updateMany({ where, data })
    return NextResponse.json({ updated: res.count })
  }

  // Assign mode (repair type + per-order cost).
  const data: Record<string, unknown> = {}
  if ('repairTypeId' in b) data.repairTypeId = b.repairTypeId || null
  if ('repairCost' in b) {
    const c = b.repairCost === null || b.repairCost === '' ? null : Number(b.repairCost)
    if (c != null && (!Number.isFinite(c) || c < 0)) return NextResponse.json({ error: 'Invalid repair cost' }, { status: 400 })
    data.repairCost = c == null ? null : new Prisma.Decimal(c.toFixed(2))
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to assign' }, { status: 400 })
  const res = await prisma.repairOrderItem.updateMany({ where, data })
  return NextResponse.json({ updated: res.count })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const itemIds: string[] = Array.isArray(b?.itemIds) ? b.itemIds.filter((x: unknown) => typeof x === 'string') : []
  if (itemIds.length === 0) return NextResponse.json({ error: 'No items selected' }, { status: 400 })
  const res = await prisma.repairOrderItem.deleteMany({ where: { id: { in: itemIds }, repairOrderId: params.id } })
  return NextResponse.json({ removed: res.count })
}
