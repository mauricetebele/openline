/**
 * POST /api/repricing/decide — approve or reject a repricing suggestion.
 * Body: { accountId, asin, itemCondition, action: 'approve' | 'reject', price?, note? }
 *
 * The group is re-evaluated server-side so we act on current data, not a stale
 * page. Approve pushes the price (the edited `price`, or the suggestion) to
 * EVERY active SKU in the ASIN+condition group and starts the strategy cooldown.
 * Reject pushes nothing and snoozes the group's triggering rule for 24 h.
 * Every decision is logged (repricing_decisions).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { updateListingPrice } from '@/lib/amazon/listings'
import { buildRepricingFeed, REJECT_SNOOZE_MS } from '@/lib/repricing/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const b = await req.json().catch(() => ({})) as {
    accountId?: string; asin?: string; itemCondition?: string
    action?: 'approve' | 'reject'; price?: number; note?: string
  }
  if (!b.accountId || !b.asin || !b.itemCondition || (b.action !== 'approve' && b.action !== 'reject')) {
    return NextResponse.json({ error: 'accountId, asin, itemCondition and action are required' }, { status: 400 })
  }

  const [group] = await buildRepricingFeed({ accountId: b.accountId, asin: b.asin, itemCondition: b.itemCondition })
  if (!group) return NextResponse.json({ error: 'Group no longer has active stock' }, { status: 404 })
  if (group.status === 'NO_DATA' || group.status === 'NO_CHANGE') {
    return NextResponse.json({ error: 'There is no longer a suggestion for this group — refresh the feed' }, { status: 409 })
  }

  const decidedBy = user.name || user.email
  const snapshot = {
    speed: group.speed, competition: group.competition, units7d: group.units7d, units30d: group.units30d,
    daysSinceLastSale: group.daysSinceLastSale, daysOfCover: group.daysOfCover, stock: group.stock,
    buyBoxPrice: group.buyBoxPrice, buyBoxHolder: group.buyBoxHolder, lowestCompetitor: group.lowestCompetitor,
    skus: group.skus.map(s => ({ sku: s.sku, price: s.price, qty: s.qty })),
    reason: group.reason,
  }
  const base = {
    accountId: group.accountId, asin: group.asin, itemCondition: group.itemCondition,
    rule: group.rule, strategy: group.strategy,
    currentPrice: group.currentPrice, suggestedPrice: group.suggestedPrice,
    marginCurrent: group.marginCurrent.min, snapshot, note: b.note?.trim() || null, decidedBy,
  }

  if (b.action === 'reject') {
    const snoozeUntil = new Date(Date.now() + REJECT_SNOOZE_MS)
    const rec = await prisma.repricingDecision.create({ data: { ...base, decision: 'REJECTED', snoozeUntil } })
    return NextResponse.json({ ok: true, decision: 'REJECTED', snoozeUntil, decisionId: rec.id, hasNote: !!base.note })
  }

  const finalPrice = typeof b.price === 'number' && b.price > 0 ? Math.round(b.price * 100) / 100 : group.suggestedPrice
  if (finalPrice == null) return NextResponse.json({ error: 'No price to push' }, { status: 400 })

  // Same price on every SKU in the ASIN+condition group.
  const pushResults: { sku: string; ok: boolean; error?: string }[] = []
  for (const s of group.skus) {
    try {
      await updateListingPrice(group.accountId, s.sku, finalPrice)
      pushResults.push({ sku: s.sku, ok: true })
    } catch (err) {
      pushResults.push({ sku: s.sku, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  const finalMargins = group.skus.map(s => s.marginSuggested).filter((m): m is number => m != null)
  const marginFinal = finalPrice === group.suggestedPrice && finalMargins.length ? Math.min(...finalMargins) : null

  const rec = await prisma.repricingDecision.create({
    data: { ...base, decision: 'APPROVED', finalPrice, marginFinal, pushResults },
  })
  const failed = pushResults.filter(r => !r.ok)
  return NextResponse.json({ ok: failed.length === 0, decision: 'APPROVED', finalPrice, pushResults, decisionId: rec.id, hasNote: !!base.note })
}
