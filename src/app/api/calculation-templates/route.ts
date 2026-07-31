/**
 * GET  /api/calculation-templates — list active templates with their per-preset costs
 * POST /api/calculation-templates — create a template
 * Body: { name, commissionPct, packageCosts: [{ packagePresetId, cost }] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

interface PackageCostInput { packagePresetId?: string; cost?: number | string }

function cleanCosts(rows: unknown): { packagePresetId: string; cost: number }[] {
  if (!Array.isArray(rows)) return []
  return rows
    .map((r) => r as PackageCostInput)
    .filter((r) => r.packagePresetId && r.cost != null && Number.isFinite(Number(r.cost)))
    .map((r) => ({ packagePresetId: r.packagePresetId as string, cost: Number(r.cost) }))
}

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const templates = await prisma.calculationTemplate.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: { packageCosts: { select: { packagePresetId: true, cost: true } } },
  })
  return NextResponse.json({ data: templates })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const commissionPct = Number(body.commissionPct)
  if (!name) return NextResponse.json({ error: 'Template name is required' }, { status: 400 })
  if (!Number.isFinite(commissionPct) || commissionPct < 0) {
    return NextResponse.json({ error: 'A valid commission percentage is required' }, { status: 400 })
  }

  try {
    const created = await prisma.calculationTemplate.create({
      data: {
        name,
        commissionPct,
        packageCosts: { create: cleanCosts(body.packageCosts) },
      },
      include: { packageCosts: true },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A template with this name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create template' }, { status: 500 })
  }
}

export { cleanCosts }
