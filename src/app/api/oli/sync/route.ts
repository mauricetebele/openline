/**
 * POST /api/oli/sync?phase=listings|buybox
 *
 * Triggers OLI's own sync phases independently:
 *   - phase=listings  → fast (5 req/s) — status, ASIN, price, qty
 *   - phase=buybox    → slow (0.5 req/s) — buy box price + winner
 *
 * Frontend calls listings first, refreshes the grid, then fires buybox
 * in the background so the user sees results immediately.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { syncOliListings, syncOliBuyBox } from '@/lib/oli/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const phase = req.nextUrl.searchParams.get('phase') ?? 'listings'

  if (phase === 'buybox') {
    const result = await syncOliBuyBox()
    return NextResponse.json({ phase: 'buybox', ...result })
  }

  // Default: listings phase
  const result = await syncOliListings()
  return NextResponse.json({ phase: 'listings', ...result })
}
