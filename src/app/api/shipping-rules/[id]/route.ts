/**
 * PUT    /api/shipping-rules/[id] — update a ruleset
 * DELETE /api/shipping-rules/[id] — delete a ruleset
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { validateRule, ruleData } from '../route'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const err = validateRule(body)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const rule = await prisma.shippingRule.update({ where: { id }, data: ruleData(body) }).catch(() => null)
  if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  return NextResponse.json({ rule })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const { id } = await params
  await prisma.shippingRule.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
