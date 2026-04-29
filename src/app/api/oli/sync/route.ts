/**
 * POST /api/oli/sync
 *
 * Triggers OLI's own sync — fetches listing data + buy box data
 * from Amazon SP-API for all SKUs across all pricing strategies.
 * Returns sync results.
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { syncOliSkus } from '@/lib/oli/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min — buy box phase can take a while

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await syncOliSkus()
  return NextResponse.json(result)
}
