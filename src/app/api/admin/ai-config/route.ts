/**
 * GET /api/admin/ai-config — is the Anthropic key set? (never returns the key)
 * PUT /api/admin/ai-config — save { anthropicKey } (stored encrypted)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/crypto'
import { getAuthUser } from '@/lib/get-auth-user'
import { aiConfigured } from '@/lib/ai-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ configured: await aiConfigured() })
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const key = String(body?.anthropicKey ?? '').trim()
  if (!key) return NextResponse.json({ error: 'Paste your Anthropic API key' }, { status: 400 })
  if (!/^sk-ant-/.test(key)) return NextResponse.json({ error: 'That does not look like an Anthropic key (starts with sk-ant-)' }, { status: 400 })

  await prisma.aiConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', anthropicKeyEnc: encrypt(key) },
    update: { anthropicKeyEnc: encrypt(key) },
  })
  return NextResponse.json({ ok: true })
}
