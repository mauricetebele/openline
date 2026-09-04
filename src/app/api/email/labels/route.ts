/**
 * GET /api/email/labels?accountId= — Gmail labels (folders) for an account.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { listLabels } from '@/lib/email/google'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = req.nextUrl.searchParams.get('accountId')
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })

  try {
    const data = await listLabels(accountId)
    return NextResponse.json({ labels: data.labels ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load labels' }, { status: 502 })
  }
}
