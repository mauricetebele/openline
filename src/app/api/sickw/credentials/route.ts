/**
 * GET  /api/sickw/credentials — check if SICKW API key is configured
 * POST /api/sickw/credentials — save/update SICKW API key (encrypted)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cred = await prisma.sickwCredential.findFirst({ where: { isActive: true } })
  if (!cred) return NextResponse.json({ configured: false })

  let maskedKey: string | null = null
  try {
    const key = decrypt(cred.apiKeyEnc)
    maskedKey = key.slice(0, 6) + '…' + key.slice(-4)
  } catch { /* ignore */ }

  return NextResponse.json({
    configured: true,
    maskedKey,
    updatedAt: cred.updatedAt,
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { apiKey } = await req.json() as { apiKey?: string }
  if (!apiKey?.trim()) {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 })
  }

  const data = { apiKeyEnc: encrypt(apiKey.trim()) }

  const existing = await prisma.sickwCredential.findFirst({ where: { isActive: true } })
  if (existing) {
    await prisma.sickwCredential.update({ where: { id: existing.id }, data })
  } else {
    await prisma.sickwCredential.create({ data })
  }

  return NextResponse.json({ success: true })
}
