/**
 * POST /api/email/send
 * Body: { accountId, to, cc?, subject, html, threadId?, inReplyTo?, references? }
 * Sends (or replies to) a message from the connected Gmail account.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { sendRawMessage } from '@/lib/email/google'

export const dynamic = 'force-dynamic'

function encodeHeader(value: string): string {
  // RFC 2047 encode non-ASCII header values (e.g. subjects with emoji/accents).
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { accountId, to, cc, subject, html, threadId, inReplyTo, references } = body as {
    accountId?: string; to?: string; cc?: string; subject?: string; html?: string
    threadId?: string; inReplyTo?: string; references?: string
  }
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  if (!to?.trim()) return NextResponse.json({ error: 'A recipient is required' }, { status: 400 })

  const account = await prisma.emailAccount.findUnique({ where: { id: accountId }, select: { email: true, displayName: true } })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const from = account.displayName ? `${encodeHeader(account.displayName)} <${account.email}>` : account.email
  const lines = [
    `From: ${from}`,
    `To: ${to.trim()}`,
    ...(cc?.trim() ? [`Cc: ${cc.trim()}`] : []),
    `Subject: ${encodeHeader(subject?.trim() || '(no subject)')}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html ?? '', 'utf8').toString('base64'),
  ]
  const raw = Buffer.from(lines.join('\r\n'), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  try {
    const sent = await sendRawMessage(accountId, raw, threadId)
    return NextResponse.json({ ok: true, sent })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to send' }, { status: 502 })
  }
}
