/**
 * GET  /api/fedex/credentials  — returns whether credentials are configured (no secrets)
 * POST /api/fedex/credentials  — save FedEx Client ID, Secret, and Account Number (encrypted)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cred = await prisma.fedexCredential.findFirst({ where: { isActive: true } })
  if (!cred) return NextResponse.json({ configured: false })

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

  return NextResponse.json({
    configured: true,
    maskedClientId,
    maskedAccountNumber,
    accountNumberConfigured: !!cred.accountNumberEnc,
    updatedAt: cred.updatedAt,
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, clientSecret, accountNumber } =
    await req.json() as { clientId?: string; clientSecret?: string; accountNumber?: string }

  if (!clientId?.trim() || !clientSecret?.trim()) {
    return NextResponse.json({ error: 'clientId and clientSecret are required' }, { status: 400 })
  }

  const data: Record<string, string> = {
    clientIdEnc:     encrypt(clientId.trim()),
    clientSecretEnc: encrypt(clientSecret.trim()),
  }
  if (accountNumber?.trim()) {
    data.accountNumberEnc = encrypt(accountNumber.trim())
  }

  const existing = await prisma.fedexCredential.findFirst({ where: { isActive: true } })
  if (existing) {
    await prisma.fedexCredential.update({ where: { id: existing.id }, data })
  } else {
    await prisma.fedexCredential.create({ data: { ...data, clientIdEnc: data.clientIdEnc, clientSecretEnc: data.clientSecretEnc } })
  }

  return NextResponse.json({ success: true })
}
