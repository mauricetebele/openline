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

  // Test/sandbox credential status
  const testConfigured = !!(cred.testClientIdEnc && cred.testClientSecretEnc && cred.testAccountNumberEnc)
  let testMaskedClientId: string | null = null
  if (testConfigured && cred.testClientIdEnc) {
    try {
      const tid = decrypt(cred.testClientIdEnc)
      testMaskedClientId = tid.slice(0, 6) + '…' + tid.slice(-4)
    } catch { /* ignore */ }
  }

  return NextResponse.json({
    configured: true,
    maskedClientId,
    maskedAccountNumber,
    updatedAt: cred.updatedAt,
    testConfigured,
    testMaskedClientId,
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, clientSecret, accountNumber, testClientId, testClientSecret, testAccountNumber } =
    await req.json() as {
      clientId?: string; clientSecret?: string; accountNumber?: string
      testClientId?: string; testClientSecret?: string; testAccountNumber?: string
    }

  // Production creds are required unless we're only saving test creds
  const hasProdFields = clientId?.trim() || clientSecret?.trim() || accountNumber?.trim()
  const hasTestFields = testClientId?.trim() || testClientSecret?.trim() || testAccountNumber?.trim()

  if (!hasProdFields && !hasTestFields) {
    return NextResponse.json({ error: 'No credentials provided' }, { status: 400 })
  }

  if (hasProdFields && (!clientId?.trim() || !clientSecret?.trim() || !accountNumber?.trim())) {
    return NextResponse.json({ error: 'Client ID, Client Secret, and Account Number are all required for shipping' }, { status: 400 })
  }

  if (hasTestFields && (!testClientId?.trim() || !testClientSecret?.trim() || !testAccountNumber?.trim())) {
    return NextResponse.json({ error: 'All three test credential fields are required (Client ID, Secret, Account Number)' }, { status: 400 })
  }

  const existing = await prisma.fedexShippingCredential.findFirst({ where: { isActive: true } })

  if (existing) {
    const updateData: { clientIdEnc?: string; clientSecretEnc?: string; accountNumberEnc?: string; testClientIdEnc?: string; testClientSecretEnc?: string; testAccountNumberEnc?: string } = {}
    if (hasProdFields) {
      updateData.clientIdEnc = encrypt(clientId!.trim())
      updateData.clientSecretEnc = encrypt(clientSecret!.trim())
      updateData.accountNumberEnc = encrypt(accountNumber!.trim())
    }
    if (hasTestFields) {
      updateData.testClientIdEnc = encrypt(testClientId!.trim())
      updateData.testClientSecretEnc = encrypt(testClientSecret!.trim())
      updateData.testAccountNumberEnc = encrypt(testAccountNumber!.trim())
    }
    await prisma.fedexShippingCredential.update({ where: { id: existing.id }, data: updateData })
  } else {
    if (!hasProdFields) {
      return NextResponse.json({ error: 'Production credentials must be configured first' }, { status: 400 })
    }
    await prisma.fedexShippingCredential.create({
      data: {
        clientIdEnc: encrypt(clientId!.trim()),
        clientSecretEnc: encrypt(clientSecret!.trim()),
        accountNumberEnc: encrypt(accountNumber!.trim()),
        ...(hasTestFields ? {
          testClientIdEnc: encrypt(testClientId!.trim()),
          testClientSecretEnc: encrypt(testClientSecret!.trim()),
          testAccountNumberEnc: encrypt(testAccountNumber!.trim()),
        } : {}),
      },
    })
  }

  return NextResponse.json({ success: true })
}
