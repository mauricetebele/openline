/**
 * POST /api/email/rules/apply
 * Body: { accountId, rule }
 * Creates the folder (if named), a Gmail filter matching the criteria, and —
 * when applyToExisting — moves/labels existing matching messages.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { canUseMailAccount } from '@/lib/email/access'
import { listLabels, createLabel, createFilter, listMessages, batchModify } from '@/lib/email/google'

export const dynamic = 'force-dynamic'

interface Rule {
  fromContains?: string | null
  toContains?: string | null
  subjectContains?: string | null
  query?: string | null
  folderName?: string | null
  removeFromInbox?: boolean
  markRead?: boolean
  star?: boolean
  applyToExisting?: boolean
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { accountId, rule } = await req.json().catch(() => ({})) as { accountId?: string; rule?: Rule }
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  if (!(await canUseMailAccount(accountId, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!rule) return NextResponse.json({ error: 'No rule provided' }, { status: 400 })

  const hasCriteria = rule.fromContains || rule.toContains || rule.subjectContains || rule.query
  if (!hasCriteria) return NextResponse.json({ error: 'The rule has no matching criteria' }, { status: 400 })

  try {
    // 1) Resolve/create the target folder.
    let folderId: string | null = null
    if (rule.folderName?.trim()) {
      const name = rule.folderName.trim()
      const { labels } = await listLabels(accountId)
      const existing = (labels ?? []).find(l => l.type === 'user' && l.name.toLowerCase() === name.toLowerCase())
      folderId = existing?.id ?? (await createLabel(accountId, name)).id
    }

    // 2) Build filter criteria + action.
    const criteria: Record<string, string> = {}
    if (rule.fromContains) criteria.from = rule.fromContains
    if (rule.toContains) criteria.to = rule.toContains
    if (rule.subjectContains) criteria.subject = rule.subjectContains
    if (rule.query) criteria.query = rule.query

    const addLabelIds: string[] = []
    const removeLabelIds: string[] = []
    if (folderId) addLabelIds.push(folderId)
    if (rule.star) addLabelIds.push('STARRED')
    if (rule.removeFromInbox) removeLabelIds.push('INBOX')
    if (rule.markRead) removeLabelIds.push('UNREAD')

    const action: Record<string, string[]> = {}
    if (addLabelIds.length) action.addLabelIds = addLabelIds
    if (removeLabelIds.length) action.removeLabelIds = removeLabelIds

    await createFilter(accountId, { criteria, action })

    // 3) Apply to existing matching messages.
    let applied = 0
    if (rule.applyToExisting !== false && (addLabelIds.length || removeLabelIds.length)) {
      const parts: string[] = []
      if (rule.fromContains) parts.push(`from:(${rule.fromContains})`)
      if (rule.toContains) parts.push(`to:(${rule.toContains})`)
      if (rule.subjectContains) parts.push(`subject:(${rule.subjectContains})`)
      if (rule.query) parts.push(rule.query)
      const q = parts.join(' ')

      let pageToken: string | undefined
      const ids: string[] = []
      for (let i = 0; i < 8 && ids.length < 800; i++) { // cap so we don't run forever
        const list = await listMessages(accountId, { q, pageToken, maxResults: 100 })
        ids.push(...(list.messages ?? []).map(m => m.id))
        pageToken = list.nextPageToken ?? undefined
        if (!pageToken) break
      }
      // batchModify handles up to 1000 ids per call.
      for (let i = 0; i < ids.length; i += 1000) {
        await batchModify(accountId, ids.slice(i, i + 1000), addLabelIds.length ? addLabelIds : undefined, removeLabelIds.length ? removeLabelIds : undefined)
      }
      applied = ids.length
    }

    return NextResponse.json({ ok: true, folderName: rule.folderName ?? null, applied })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to create rule' }, { status: 502 })
  }
}
