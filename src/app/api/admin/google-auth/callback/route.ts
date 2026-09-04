/**
 * GET /api/admin/google-auth/callback — store the admin's OAuth refresh token
 * for GCIP password-setting.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { decodeIdToken } from '@/lib/email/google'
import { exchangeAdminCode, saveAdminOAuth } from '@/lib/gcip-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const user = await getAuthUser()
  if (!user || user.role !== 'ADMIN') return NextResponse.redirect(new URL('/login', origin))

  const params = req.nextUrl.searchParams
  const error = params.get('error')
  if (error) return NextResponse.redirect(new URL(`/settings?section=users&adminauth=${encodeURIComponent(error)}`, origin))

  const code = params.get('code')
  const state = params.get('state')
  const cookieState = req.cookies.get('gcip_admin_state')?.value
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL('/settings?section=users&adminauth=invalid_state', origin))
  }

  try {
    const redirectUri = `${origin}/api/admin/google-auth/callback`
    const tokens = await exchangeAdminCode(code, redirectUri)
    if (!tokens.refresh_token) throw new Error('no_refresh_token')
    const profile = decodeIdToken(tokens.id_token)
    await saveAdminOAuth(profile.email, tokens.refresh_token)
    const res = NextResponse.redirect(new URL('/settings?section=users&adminauth=ok', origin))
    res.cookies.delete('gcip_admin_state')
    return res
  } catch (e) {
    return NextResponse.redirect(new URL(`/settings?section=users&adminauth=${encodeURIComponent(e instanceof Error ? e.message : 'failed')}`, origin))
  }
}
