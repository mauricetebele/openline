/**
 * POST /api/repricing/ack — Claude's short reply to the comment left on an
 * approve / reject decision. Body: { decisionId }. Stored on the decision.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { replyToDecisionComment } from '@/lib/repricing/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { decisionId?: string }
  if (!b.decisionId) return NextResponse.json({ error: 'decisionId is required' }, { status: 400 })
  try {
    const reply = await replyToDecisionComment(b.decisionId)
    return NextResponse.json({ reply })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI reply failed' }, { status: 500 })
  }
}
