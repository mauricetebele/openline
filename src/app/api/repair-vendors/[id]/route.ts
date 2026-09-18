/**
 * PATCH  /api/repair-vendors/[id]  — update vendor fields
 * DELETE /api/repair-vendors/[id]  — remove (blocked if it has repair orders)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  for (const k of ['companyName', 'email', 'phone', 'address1', 'address2', 'city', 'state', 'postal', 'country']) {
    if (k in b) data[k] = typeof b[k] === 'string' && b[k].trim() ? b[k].trim() : (k === 'companyName' || k === 'country' ? undefined : null)
  }
  if ('isActive' in b) data.isActive = !!b.isActive
  const vendor = await prisma.repairVendor.update({ where: { id: params.id }, data }).catch(() => null)
  if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  return NextResponse.json(vendor)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const count = await prisma.repairOrder.count({ where: { vendorId: params.id } })
  if (count > 0) return NextResponse.json({ error: `Vendor has ${count} repair order(s) — deactivate it instead.` }, { status: 409 })
  await prisma.repairVendor.delete({ where: { id: params.id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
