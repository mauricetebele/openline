/**
 * POST /api/email/rules/interpret
 * Body: { text }
 * Uses Claude to turn a plain-English email rule into a structured Gmail filter,
 * plus a natural-language confirmation of what it understood. Returns { understanding, rule }.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { getAnthropicKey } from '@/lib/ai-config'

export const dynamic = 'force-dynamic'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

const SYSTEM = `You convert a plain-English email-handling rule into a structured Gmail filter.
Return ONLY a JSON object (no prose, no markdown fences) with this shape:
{
  "understanding": string,   // one or two friendly sentences, in your own words, restating exactly what the rule will do, so the user can confirm. Mention the folder name and whether existing emails are included.
  "rule": {
    "fromContains": string | null,   // match sender contains this (e.g. "@pcsww.com" for a whole domain)
    "toContains": string | null,     // match recipient contains this
    "subjectContains": string | null,// match subject contains this
    "query": string | null,          // extra Gmail search terms (e.g. "has:attachment")
    "folderName": string | null,     // folder to file matches into (created if missing)
    "removeFromInbox": boolean,      // true when the intent is to "move"/"file" (skip inbox); false to just label
    "markRead": boolean,             // true if it should also mark as read
    "star": boolean,                 // true if it should also star
    "applyToExisting": boolean       // true if existing matching emails should also be moved now (default true unless they clearly say only future mail)
  },
  "needsClarification": string | null // if the request is ambiguous or you cannot form a rule, put a short question here and leave rule fields null
}
Rules of thumb: "from anyone with an @domain" => fromContains "@domain". "into a folder called X" / "move to X" => folderName "X", removeFromInbox true. If they only say "label as X", removeFromInbox false. Prefer applyToExisting true unless they say "going forward" / "new emails".`

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = await getAnthropicKey()
  if (!apiKey) return NextResponse.json({ error: 'AI is not configured — add your Anthropic API key.', needsKey: true }, { status: 400 })

  const { text } = await req.json().catch(() => ({}))
  if (!text || !String(text).trim()) return NextResponse.json({ error: 'Describe the rule' }, { status: 400 })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system: SYSTEM,
        messages: [{ role: 'user', content: String(text).trim() }],
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message ?? 'AI request failed')
    const raw = (data.content?.[0]?.text ?? '').trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim()
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new Error('Could not understand the rule — try rephrasing') }
    return NextResponse.json(parsed)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI request failed' }, { status: 502 })
  }
}
