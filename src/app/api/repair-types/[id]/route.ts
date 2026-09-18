/**
 * PATCH  /api/repair-types/[id]  — rename / toggle active
 * DELETE /api/repair-types/[id]  — remove (blocked if used on any repair item)
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
  if (typeof b?.name === 'string' && b.name.trim()) data.name = b.name.trim()
  if ('isActive' in b) data.isActive = !!b.isActive
  const type = await prisma.repairType.update({ where: { id: params.id }, data }).catch(() => null)
  if (!type) return NextResponse.json({ error: 'Repair type not found or name taken' }, { status: 404 })
  return NextResponse.json(type)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const count = await prisma.repairOrderItem.count({ where: { repairTypeId: params.id } })
  if (count > 0) return NextResponse.json({ error: `Used on ${count} repair item(s) — deactivate it instead.` }, { status: 409 })
  await prisma.repairType.delete({ where: { id: params.id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
