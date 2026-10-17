/**
 * GET  /api/shipping-rules        — list rulesets (with their package preset)
 * POST /api/shipping-rules        — create a ruleset
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

const CARRIER_TYPES = ['shipstation', 'fedex_direct', 'ups_direct']
const VALUE_OPS = ['gt', 'lt', 'gte', 'lte']

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rules = await prisma.shippingRule.findMany({
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    include: { packagePreset: { select: { id: true, name: true } } },
  })
  return NextResponse.json({ rules })
}

interface RuleBody {
  name?: string; priority?: number; active?: boolean; packagePresetId?: string | null
  transitEnabled?: boolean; transitMaxDays?: number | null; transitWithin?: boolean
  valueEnabled?: boolean; valueOperator?: string | null; valueAmount?: number | null
  thenCarrierType?: string; thenCarrierCode?: string | null; thenServiceCode?: string
  thenServiceName?: string | null; thenUpsCredentialId?: string | null; thenConfirmation?: string | null
}

export function validateRule(b: RuleBody): string | null {
  if (!b.name?.trim()) return 'Name is required'
  if (!b.thenCarrierType || !CARRIER_TYPES.includes(b.thenCarrierType)) return 'A valid "then" carrier type is required'
  if (!b.thenServiceCode?.trim()) return 'A "then" service is required'
  if (b.thenCarrierType === 'shipstation' && !b.thenCarrierCode?.trim()) return 'ShipStation method needs a carrier'
  if (b.valueEnabled) {
    if (!b.valueOperator || !VALUE_OPS.includes(b.valueOperator)) return 'A valid order-value operator is required'
    if (b.valueAmount == null || isNaN(Number(b.valueAmount))) return 'An order-value amount is required'
  }
  if (b.transitEnabled && (b.transitMaxDays == null || b.transitMaxDays < 0)) return 'A valid transit day count is required'
  if (!b.transitEnabled && !b.valueEnabled) return 'Enable at least one condition (transit or order value)'
  return null
}

export function ruleData(b: RuleBody) {
  return {
    name: b.name!.trim(),
    priority: b.priority ?? 0,
    active: b.active ?? true,
    packagePresetId: b.packagePresetId || null,
    transitEnabled: !!b.transitEnabled,
    transitMaxDays: b.transitEnabled ? Number(b.transitMaxDays) : null,
    transitWithin: b.transitWithin ?? true,
    valueEnabled: !!b.valueEnabled,
    valueOperator: b.valueEnabled ? b.valueOperator! : null,
    valueAmount: b.valueEnabled ? Number(b.valueAmount) : null,
    thenCarrierType: b.thenCarrierType!,
    thenCarrierCode: b.thenCarrierType === 'shipstation' ? (b.thenCarrierCode || null) : null,
    thenServiceCode: b.thenServiceCode!.trim(),
    thenServiceName: b.thenServiceName?.trim() || null,
    thenUpsCredentialId: b.thenCarrierType === 'ups_direct' ? (b.thenUpsCredentialId || null) : null,
    thenConfirmation: b.thenConfirmation && b.thenConfirmation !== 'none' ? b.thenConfirmation : null,
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const body = await req.json().catch(() => null) as RuleBody | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const err = validateRule(body)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const rule = await prisma.shippingRule.create({ data: ruleData(body) })
  return NextResponse.json({ rule }, { status: 201 })
}
