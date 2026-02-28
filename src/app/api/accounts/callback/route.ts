/**
 * GET /api/accounts/callback
 *
 * Amazon redirects here after seller grants consent.
 * Query params from Amazon:
 *   spapi_oauth_code  — one-time code to exchange for tokens
 *   selling_partner_id — Seller ID (e.g. A1B2C3...)
 *   state              — echoed back (for CSRF validation)
 *
 * Marketplace detection: sellers in NA region primarily have marketplaceId ATVPDKIKX0DER (US).
 * For EU/FE support add marketplaceId mapping based on the Seller Central region they used.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/crypto'
import { exchangeCodeForTokens } from '@/lib/amazon/lwa'

const MARKETPLACE_MAP: Record<string, { name: string; region: string }> = {
  ATVPDKIKX0DER: { name: 'Amazon.com (US)', region: 'NA' },
  A2EUQ1WTGCTBG2: { name: 'Amazon.ca (CA)', region: 'NA' },
  A1F83G8C2ARO7P: { name: 'Amazon.co.uk (UK)', region: 'EU' },
  A1PA6795UKMFR9: { name: 'Amazon.de (DE)', region: 'EU' },
  APJ6JRA9NG5V4:  { name: 'Amazon.it (IT)', region: 'EU' },
  A13V1IB3VIYZZH: { name: 'Amazon.fr (FR)', region: 'EU' },
  A1RKKUPIHCS9HS: { name: 'Amazon.es (ES)', region: 'EU' },
  A39IBJ37TRP1C6: { name: 'Amazon.com.au (AU)', region: 'FE' },
  A1VC38T7YXB528: { name: 'Amazon.co.jp (JP)', region: 'FE' },
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('spapi_oauth_code')
  const sellerId = searchParams.get('selling_partner_id')

  if (!code || !sellerId) {
    return NextResponse.redirect(
      new URL('/connect?error=missing_params', process.env.NEXT_PUBLIC_APP_URL),
    )
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1_000)

    // Default to US marketplace for MVP — sellers can add others later
    const marketplaceId = 'ATVPDKIKX0DER'
    const marketplaceInfo = MARKETPLACE_MAP[marketplaceId] ?? { name: 'Unknown', region: 'NA' }

    await prisma.amazonAccount.upsert({
      where: { sellerId_marketplaceId: { sellerId, marketplaceId } },
      update: {
        accessTokenEnc: encrypt(tokens.access_token),
        refreshTokenEnc: encrypt(tokens.refresh_token),
        tokenExpiresAt: expiresAt,
        isActive: true,
      },
      create: {
        sellerId,
        marketplaceId,
        marketplaceName: marketplaceInfo.name,
        region: marketplaceInfo.region,
        accessTokenEnc: encrypt(tokens.access_token),
        refreshTokenEnc: encrypt(tokens.refresh_token),
        tokenExpiresAt: expiresAt,
      },
    })

    return NextResponse.redirect(
      new URL('/connect?success=1', process.env.NEXT_PUBLIC_APP_URL),
    )
  } catch (err) {
    console.error('Amazon OAuth callback error:', err)
    return NextResponse.redirect(
      new URL('/connect?error=token_exchange_failed', process.env.NEXT_PUBLIC_APP_URL),
    )
  }
}
