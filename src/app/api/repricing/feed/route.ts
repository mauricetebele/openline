/**
 * GET /api/repricing/feed — Amazon repricing suggestions, one row per
 * ASIN + condition group (see lib/repricing/engine.ts). Read-only.
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { buildRepricingFeed } from '@/lib/repricing/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const groups = await buildRepricingFeed()
  return NextResponse.json({ groups, generatedAt: new Date().toISOString() })
}
