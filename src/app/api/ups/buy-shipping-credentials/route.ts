/**
 * GET  /api/ups/buy-shipping-credentials — returns whether credentials are configured (no secrets)
 * POST /api/ups/buy-shipping-credentials — save UPS Buy Shipping credentials (encrypted)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cred = await prisma.upsBuyShippingCredential.findFirst({ where: { isActive: true } })
  if (!cred) return NextResponse.json({ configured: false })

  let maskedAccountNumber: string | null = null
  try {
    const an = decrypt(cred.accountNumberEnc)
    maskedAccountNumber = an.slice(0, 3) + '…' + an.slice(-3)
  } catch { /* ignore */ }

  let maskedUsername: string | null = null
  try {
    const u = decrypt(cred.upsUsernameEnc)
    maskedUsername = u.slice(0, 3) + '…' + u.slice(-3)
  } catch { /* ignore */ }

  return NextResponse.json({
    configured: true,
    maskedAccountNumber,
    maskedUsername,
    lastLinkedAt: cred.lastLinkedAt,
    updatedAt: cred.updatedAt,
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    accountNumber?: string
    accountZip?: string
    shipFromCity?: string
    shipFromZip?: string
    country?: string
    upsUsername?: string
    upsPassword?: string
  }

  const { accountNumber, accountZip, shipFromCity, shipFromZip, country, upsUsername, upsPassword } = body

  if (!accountNumber?.trim() || !accountZip?.trim() || !shipFromCity?.trim() ||
      !shipFromZip?.trim() || !country?.trim() || !upsUsername?.trim() || !upsPassword?.trim()) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }

  const data = {
    accountNumberEnc: encrypt(accountNumber.trim()),
    accountZipEnc:    encrypt(accountZip.trim()),
    shipFromCityEnc:  encrypt(shipFromCity.trim()),
    shipFromZipEnc:   encrypt(shipFromZip.trim()),
    countryEnc:       encrypt(country.trim()),
    upsUsernameEnc:   encrypt(upsUsername.trim()),
    upsPasswordEnc:   encrypt(upsPassword.trim()),
  }

  const existing = await prisma.upsBuyShippingCredential.findFirst({ where: { isActive: true } })
  if (existing) {
    await prisma.upsBuyShippingCredential.update({ where: { id: existing.id }, data })
  } else {
    await prisma.upsBuyShippingCredential.create({ data })
  }

  return NextResponse.json({ success: true })
}
