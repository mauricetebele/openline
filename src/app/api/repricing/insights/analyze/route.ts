/**
 * POST /api/repricing/insights/analyze — run Claude over the whole decision log
 * and store learnings + proposed parameter changes (nothing is applied here).
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { analyzeRepricingFeedback } from '@/lib/repricing/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr
  try {
    const learning = await analyzeRepricingFeedback(user.name || user.email)
    return NextResponse.json({ learning })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Analysis failed' }, { status: 500 })
  }
}
