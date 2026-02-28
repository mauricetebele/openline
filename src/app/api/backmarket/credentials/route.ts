/**
 * GET  /api/backmarket/credentials  — returns whether a key is configured (no secret)
 * POST /api/backmarket/credentials  — save / update Back Market API key (encrypted)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cred = await prisma.backMarketCredential.findFirst({ where: { isActive: true } })
  if (!cred) return NextResponse.json({ configured: false })

  let maskedKey: string | null = null
  try {
    const key = decrypt(cred.apiKeyEnc)
    maskedKey = key.slice(0, 6) + '…' + key.slice(-4)
  } catch { /* ignore */ }

  return NextResponse.json({ configured: true, maskedKey, updatedAt: cred.updatedAt })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { apiKey } = await req.json() as { apiKey?: string }
  if (!apiKey?.trim()) {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 })
  }

  const existing = await prisma.backMarketCredential.findFirst({ where: { isActive: true } })
  if (existing) {
    await prisma.backMarketCredential.update({
      where: { id: existing.id },
      data: { apiKeyEnc: encrypt(apiKey.trim()) },
    })
  } else {
    await prisma.backMarketCredential.create({
      data: { apiKeyEnc: encrypt(apiKey.trim()) },
    })
  }

  return NextResponse.json({ success: true })
}
