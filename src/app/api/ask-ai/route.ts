/**
 * POST /api/ask-ai
 * Body: { messages: AnthropicMessage[], approved?: string[] }
 *   - messages : the running Anthropic conversation (user/assistant/tool_result turns)
 *   - approved : tool_use ids the user has confirmed (for send_email actions)
 *
 * Returns either:
 *   { type: 'message', text, messages }                     — assistant finished
 *   { type: 'confirm', pending: { toolUseId, input }, messages } — needs confirmation
 *
 * Admin-only. Uses the encrypted Anthropic key from StoreSettings.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { runAskAi, DEFAULT_MODEL } from '@/lib/ask-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const body = await req.json().catch(() => null)
  const messages = Array.isArray(body?.messages) ? body.messages : null
  const approved = Array.isArray(body?.approved) ? body.approved.filter((x: unknown) => typeof x === 'string') : []
  if (!messages || messages.length === 0) return NextResponse.json({ error: 'messages are required' }, { status: 400 })

  const s = await prisma.storeSettings.findUnique({ where: { id: 'singleton' }, select: { anthropicApiKeyEnc: true, aiModel: true } })
  if (!s?.anthropicApiKeyEnc) return NextResponse.json({ error: 'Ask AI is not configured — add an Anthropic API key in the Ask AI panel.' }, { status: 400 })

  let key: string
  try { key = decrypt(s.anthropicApiKeyEnc) } catch { return NextResponse.json({ error: 'Stored API key could not be read — re-enter it.' }, { status: 400 }) }

  try {
    const result = await runAskAi({ key, model: s.aiModel || DEFAULT_MODEL, messages, approved })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ask AI failed' }, { status: 500 })
  }
}
