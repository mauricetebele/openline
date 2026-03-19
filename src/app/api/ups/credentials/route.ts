/**
 * GET  /api/ups/credentials  — list all active UPS credential accounts
 * POST /api/ups/credentials  — add a new UPS credential account
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const creds = await prisma.upsCredential.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  })

  if (creds.length === 0) return NextResponse.json({ configured: false, accounts: [] })

  const accounts = creds.map(cred => {
    let maskedClientId: string | null = null
    try {
      const id = decrypt(cred.clientIdEnc)
      maskedClientId = id.slice(0, 6) + '…' + id.slice(-4)
    } catch { /* ignore */ }

    let maskedAccountNumber: string | null = null
    try {
      if (cred.accountNumberEnc) {
        const an = decrypt(cred.accountNumberEnc)
        maskedAccountNumber = an.slice(0, 3) + '…' + an.slice(-3)
      }
    } catch { /* ignore */ }

    return {
      id: cred.id,
      nickname: cred.nickname,
      isDefault: cred.isDefault,
      maskedClientId,
      maskedAccountNumber,
      accountNumberConfigured: !!cred.accountNumberEnc,
      updatedAt: cred.updatedAt,
    }
  })

  return NextResponse.json({ configured: true, accounts })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, clientSecret, accountNumber, nickname } =
    await req.json() as { clientId?: string; clientSecret?: string; accountNumber?: string; nickname?: string }

  if (!clientId?.trim() || !clientSecret?.trim()) {
    return NextResponse.json({ error: 'clientId and clientSecret are required' }, { status: 400 })
  }

  const data: Record<string, unknown> = {
    nickname:        (nickname?.trim()) || 'Primary',
    clientIdEnc:     encrypt(clientId.trim()),
    clientSecretEnc: encrypt(clientSecret.trim()),
  }
  if (accountNumber?.trim()) {
    data.accountNumberEnc = encrypt(accountNumber.trim())
  }

  // If no active accounts exist, auto-set this one as default
  const existingCount = await prisma.upsCredential.count({ where: { isActive: true } })
  if (existingCount === 0) {
    data.isDefault = true
  }

  await prisma.upsCredential.create({ data: data as Parameters<typeof prisma.upsCredential.create>[0]['data'] })

  return NextResponse.json({ success: true })
}
