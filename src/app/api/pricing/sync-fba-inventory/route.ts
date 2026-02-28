/**
 * POST /api/pricing/sync-fba-inventory
 * Body: { accountId: string }
 *
 * Triggers a full FBA inventory sync for the account — paginates through all
 * FBA inventory summaries and updates the quantity field on matching listings.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { syncFbaInventory } from '@/lib/amazon/fba-inventory'
import { requireAdmin, requireActiveAccount } from '@/lib/auth-helpers'

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const adminErr = requireAdmin(user)
    if (adminErr) return adminErr

    const { accountId } = await req.json()
    if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

    const accountOrErr = await requireActiveAccount(accountId)
    if (accountOrErr instanceof NextResponse) return accountOrErr

    const { updated, total } = await syncFbaInventory(accountId)

    return NextResponse.json({ ok: true, updated, total })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/pricing/sync-fba-inventory]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
