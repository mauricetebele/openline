/**
 * GET  /api/accounts  — list connected Amazon accounts
 * POST /api/accounts  — save an account using a self-authorized refresh token
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/crypto'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.amazonAccount.findMany({
    where: { isActive: true },
    select: {
      id: true,
      sellerId: true,
      marketplaceId: true,
      marketplaceName: true,
      region: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(accounts)
}

/** Save an Amazon account using a self-authorized refresh token from Seller Central. */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const { sellerId, refreshToken, marketplaceId = 'ATVPDKIKX0DER' } = await req.json()

  if (!sellerId || !refreshToken) {
    return NextResponse.json({ error: 'sellerId and refreshToken are required' }, { status: 400 })
  }

  try {
    const account = await prisma.amazonAccount.upsert({
      where: { sellerId_marketplaceId: { sellerId, marketplaceId } },
      update: {
        refreshTokenEnc: encrypt(refreshToken),
        accessTokenEnc: encrypt('PENDING'),
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        isActive: true,
      },
      create: {
        sellerId,
        marketplaceId,
        marketplaceName: 'Amazon.com',
        region: 'NA',
        accessTokenEnc: encrypt('PENDING'),
        refreshTokenEnc: encrypt(refreshToken),
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
      },
    })

    return NextResponse.json({ ok: true, id: account.id })
  } catch (err) {
    console.error('Failed to save Amazon account:', err)
    return NextResponse.json({ error: 'Failed to save account' }, { status: 500 })
  }
}
