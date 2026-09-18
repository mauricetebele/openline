/**
 * GET  /api/ask-ai/config  — { configured, model, isAdmin }
 * POST /api/ask-ai/config  — admin: save the Anthropic API key (encrypted) + model
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/crypto'
import { DEFAULT_MODEL } from '@/lib/ask-ai'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const s = await prisma.storeSettings.findUnique({ where: { id: 'singleton' }, select: { anthropicApiKeyEnc: true, aiModel: true } })
  const isAdmin = requireAdmin(user) === null
  return NextResponse.json({ configured: !!s?.anthropicApiKeyEnc, model: s?.aiModel || DEFAULT_MODEL, isAdmin })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const body = await req.json().catch(() => ({}))
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : undefined

  const data: { anthropicApiKeyEnc?: string; aiModel?: string } = {}
  if (apiKey) data.anthropicApiKeyEnc = encrypt(apiKey)
  if (model) data.aiModel = model
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })

  await prisma.storeSettings.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  })
  return NextResponse.json({ ok: true, configured: true })
}
