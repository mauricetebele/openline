/**
 * GET    /api/veeqo/credentials — whether a Veeqo API key is configured (masked)
 * POST   /api/veeqo/credentials — save the Veeqo API key (encrypted)
 * DELETE /api/veeqo/credentials — remove the Veeqo credential
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cred = await prisma.veeqoCredential.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' } })
  if (!cred) return NextResponse.json({ configured: false })

  let maskedKey: string | null = null
  try { const k = decrypt(cred.apiKeyEnc); maskedKey = `${k.slice(0, 4)}…${k.slice(-4)}` } catch { /* ignore */ }

  return NextResponse.json({
    configured: true,
    maskedKey,
    nickname: cred.nickname,
    updatedAt: cred.updatedAt,
    lastTestedAt: cred.lastTestedAt,
    lastTestOk: cred.lastTestOk,
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { apiKey, nickname } = await req.json().catch(() => ({})) as { apiKey?: string; nickname?: string }
  if (!apiKey?.trim()) return NextResponse.json({ error: 'API key is required' }, { status: 400 })

  const existing = await prisma.veeqoCredential.findFirst({ where: { isActive: true } })
  if (existing) {
    await prisma.veeqoCredential.update({
      where: { id: existing.id },
      data: { apiKeyEnc: encrypt(apiKey.trim()), nickname: nickname?.trim() || null, lastTestedAt: null, lastTestOk: null },
    })
  } else {
    await prisma.veeqoCredential.create({
      data: { apiKeyEnc: encrypt(apiKey.trim()), nickname: nickname?.trim() || null },
    })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.veeqoCredential.deleteMany({})
  return NextResponse.json({ success: true })
}
