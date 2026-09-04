/**
 * GET /api/email/google/callback — OAuth redirect target.
 * Exchanges the code, identifies the mailbox, and stores the account.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { exchangeCode, decodeIdToken, saveAccountTokens } from '@/lib/email/google'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  const origin = req.nextUrl.origin
  if (!user) return NextResponse.redirect(new URL('/login', origin))

  const params = req.nextUrl.searchParams
  const error = params.get('error')
  if (error) return NextResponse.redirect(new URL(`/mail?error=${encodeURIComponent(error)}`, origin))

  const code = params.get('code')
  const state = params.get('state')
  const cookieState = req.cookies.get('gmail_oauth_state')?.value
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL('/mail?error=invalid_state', origin))
  }

  try {
    const redirectUri = `${origin}/api/email/google/callback`
    const tokens = await exchangeCode(code, redirectUri)
    const profile = decodeIdToken(tokens.id_token)
    if (!profile.email) throw new Error('Could not read account email from Google')
    await saveAccountTokens(profile.email, profile.name, tokens, user.name || user.email, user.dbId)
    const res = NextResponse.redirect(new URL(`/mail?connected=${encodeURIComponent(profile.email)}`, origin))
    res.cookies.delete('gmail_oauth_state')
    return res
  } catch (e) {
    return NextResponse.redirect(new URL(`/mail?error=${encodeURIComponent(e instanceof Error ? e.message : 'connect_failed')}`, origin))
  }
}
