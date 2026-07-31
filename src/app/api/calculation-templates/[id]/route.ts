/**
 * PATCH  /api/calculation-templates/[id] — update name/commission/package costs/isActive
 * DELETE /api/calculation-templates/[id] — soft-delete (isActive=false)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { cleanCosts } from '../route'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const data: { name?: string; commissionPct?: number; isActive?: boolean } = {}
  if (typeof body.name === 'string') data.name = body.name.trim()
  if (body.commissionPct !== undefined) {
    const c = Number(body.commissionPct)
    if (!Number.isFinite(c) || c < 0) return NextResponse.json({ error: 'Invalid commission percentage' }, { status: 400 })
    data.commissionPct = c
  }
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive

  try {
    // Replace the per-preset costs wholesale when provided.
    if (Array.isArray(body.packageCosts)) {
      const costs = cleanCosts(body.packageCosts)
      await prisma.$transaction([
        prisma.calculationTemplatePackageCost.deleteMany({ where: { templateId: params.id } }),
        ...(costs.length
          ? [prisma.calculationTemplatePackageCost.createMany({
              data: costs.map((c) => ({ templateId: params.id, packagePresetId: c.packagePresetId, cost: c.cost })),
            })]
          : []),
      ])
    }

    const updated = await prisma.calculationTemplate.update({
      where: { id: params.id },
      data,
      include: { packageCosts: true },
    })
    return NextResponse.json(updated)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A template with this name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update template' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.calculationTemplate.update({ where: { id: params.id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
}
