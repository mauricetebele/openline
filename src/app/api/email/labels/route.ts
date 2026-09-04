/**
 * GET /api/email/labels?accountId= — Gmail labels (folders) for an account.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { listLabels, createLabel } from '@/lib/email/google'
import { canUseMailAccount } from '@/lib/email/access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = req.nextUrl.searchParams.get('accountId')
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  if (!(await canUseMailAccount(accountId, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const data = await listLabels(accountId)
    return NextResponse.json({ labels: data.labels ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load labels' }, { status: 502 })
  }
}

// Create a folder (Gmail label).
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const accountId = body?.accountId
  const name = String(body?.name ?? '').trim()
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'A folder name is required' }, { status: 400 })
  if (!(await canUseMailAccount(accountId, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const label = await createLabel(accountId, name)
    return NextResponse.json({ label })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to create folder'
    return NextResponse.json({ error: /409|exist/i.test(msg) ? 'A folder with that name already exists' : msg }, { status: 502 })
  }
}
