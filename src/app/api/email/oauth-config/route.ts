/**
 * GET  /api/email/oauth-config — is Google OAuth configured? (never returns the secret)
 * PUT  /api/email/oauth-config — save { clientId, clientSecret } (stored encrypted)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/crypto'
import { getAuthUser } from '@/lib/get-auth-user'
import { googleConfigured } from '@/lib/email/google'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cfg = await prisma.googleOAuthConfig.findUnique({ where: { id: 'singleton' } }).catch(() => null)
  return NextResponse.json({
    configured: await googleConfigured(),
    hasClientId: !!cfg?.clientIdEnc,
    hasClientSecret: !!cfg?.clientSecretEnc,
  })
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const clientId = String(body?.clientId ?? '').trim()
  const clientSecret = String(body?.clientSecret ?? '').trim()
  if (!clientId || !clientSecret) return NextResponse.json({ error: 'Both Client ID and Client Secret are required' }, { status: 400 })

  await prisma.googleOAuthConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', clientIdEnc: encrypt(clientId), clientSecretEnc: encrypt(clientSecret) },
    update: { clientIdEnc: encrypt(clientId), clientSecretEnc: encrypt(clientSecret) },
  })
  return NextResponse.json({ ok: true })
}
