/**
 * POST /api/repricing/insights/proposal — act on a proposed parameter change.
 * Body: { learningId, proposalId, action: 'apply' | 'dismiss' }
 *   or  { action: 'reset', strategy, param }  → remove an override (back to default)
 * Applying writes repricing_strategy_params; the feed picks it up immediately.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { STRATEGY_PARAM_KEYS, type StrategyParams } from '@/lib/repricing/engine'
import { validProposalValue, type LearningProposal } from '@/lib/repricing/ai'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr
  const who = user.name || user.email
  const b = await req.json().catch(() => ({})) as { learningId?: string; proposalId?: string; action?: string; strategy?: string; param?: string }

  if (b.action === 'reset') {
    if (!b.strategy || !b.param) return NextResponse.json({ error: 'strategy and param are required' }, { status: 400 })
    await prisma.repricingStrategyParam.deleteMany({ where: { strategy: b.strategy, param: b.param } })
    return NextResponse.json({ ok: true })
  }

  if (!b.learningId || !b.proposalId || (b.action !== 'apply' && b.action !== 'dismiss')) {
    return NextResponse.json({ error: 'learningId, proposalId and action are required' }, { status: 400 })
  }
  const learning = await prisma.repricingLearning.findUnique({ where: { id: b.learningId } })
  if (!learning) return NextResponse.json({ error: 'Learning not found' }, { status: 404 })
  const proposals = learning.proposals as unknown as LearningProposal[]
  const p = proposals.find(x => x.id === b.proposalId)
  if (!p) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  if (p.status !== 'PENDING') return NextResponse.json({ error: `Already ${p.status.toLowerCase()}` }, { status: 409 })

  if (b.action === 'apply') {
    if (!STRATEGY_PARAM_KEYS.includes(p.param as keyof StrategyParams) || !validProposalValue(p.param, p.proposedValue)) {
      return NextResponse.json({ error: 'Proposed value is out of range' }, { status: 400 })
    }
    await prisma.repricingStrategyParam.upsert({
      where: { strategy_param: { strategy: p.strategy, param: p.param } },
      create: { strategy: p.strategy, param: p.param, value: p.proposedValue, source: `learning:${learning.id}`, updatedBy: who },
      update: { value: p.proposedValue, source: `learning:${learning.id}`, updatedBy: who },
    })
  }
  const updated = proposals.map(x => (x.id === p.id
    ? { ...x, status: b.action === 'apply' ? 'APPLIED' as const : 'DISMISSED' as const, decidedBy: who, decidedAt: new Date().toISOString() }
    : x))
  await prisma.repricingLearning.update({ where: { id: learning.id }, data: { proposals: updated as unknown as object } })
  return NextResponse.json({ ok: true })
}
