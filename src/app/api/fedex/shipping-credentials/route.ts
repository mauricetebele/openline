/**
 * GET  /api/fedex/shipping-credentials  — returns whether shipping credentials are configured
 * POST /api/fedex/shipping-credentials  — save FedEx shipping credentials (encrypted)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cred = await prisma.fedexShippingCredential.findFirst({ where: { isActive: true } })
  if (!cred) return NextResponse.json({ configured: false })

  let maskedClientId: string | null = null
  try {
    const id = decrypt(cred.clientIdEnc)
    maskedClientId = id.slice(0, 6) + '…' + id.slice(-4)
  } catch { /* ignore */ }

  let maskedAccountNumber: string | null = null
  try {
    const an = decrypt(cred.accountNumberEnc)
    maskedAccountNumber = an.slice(0, 3) + '…' + an.slice(-3)
  } catch { /* ignore */ }

  return NextResponse.json({
    configured: true,
    maskedClientId,
    maskedAccountNumber,
    updatedAt: cred.updatedAt,
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, clientSecret, accountNumber } =
    await req.json() as { clientId?: string; clientSecret?: string; accountNumber?: string }

  if (!clientId?.trim() || !clientSecret?.trim() || !accountNumber?.trim()) {
    return NextResponse.json({ error: 'Client ID, Client Secret, and Account Number are all required for shipping' }, { status: 400 })
  }

  const data = {
    clientIdEnc:     encrypt(clientId.trim()),
    clientSecretEnc: encrypt(clientSecret.trim()),
    accountNumberEnc: encrypt(accountNumber.trim()),
  }

  const existing = await prisma.fedexShippingCredential.findFirst({ where: { isActive: true } })
  if (existing) {
    await prisma.fedexShippingCredential.update({ where: { id: existing.id }, data })
  } else {
    await prisma.fedexShippingCredential.create({ data })
  }

  return NextResponse.json({ success: true })
}
