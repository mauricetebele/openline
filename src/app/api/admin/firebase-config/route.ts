/**
 * GET /api/admin/firebase-config — is the Firebase Admin service account set? (never returns it)
 * PUT /api/admin/firebase-config — save { serviceAccount } (JSON string, stored encrypted)
 *
 * Enables admin ops (e.g. directly setting a user's password) without env vars.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/crypto'
import { getAuthUser } from '@/lib/get-auth-user'
import { adminConfigured } from '@/lib/firebase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ configured: await adminConfigured() })
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const raw = String(body?.serviceAccount ?? '').trim()
  if (!raw) return NextResponse.json({ error: 'Paste the service account JSON' }, { status: 400 })

  let parsed: { client_email?: string; private_key?: string; project_id?: string }
  try { parsed = JSON.parse(raw) } catch { return NextResponse.json({ error: 'That is not valid JSON' }, { status: 400 }) }
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    return NextResponse.json({ error: 'JSON is missing project_id / client_email / private_key' }, { status: 400 })
  }

  await prisma.firebaseAdminConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', serviceAccountEnc: encrypt(raw) },
    update: { serviceAccountEnc: encrypt(raw) },
  })
  return NextResponse.json({ ok: true })
}
