/**
 * GET /api/email/google/connect — start the Google OAuth consent flow.
 * Redirects the browser to Google; the callback stores the account.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAuthUser } from '@/lib/get-auth-user'
import { buildAuthUrl, getGoogleCreds } from '@/lib/email/google'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && !user.canAccessMail) {
    return NextResponse.redirect(new URL('/mail?error=no_access', req.nextUrl.origin))
  }

  const creds = await getGoogleCreds()
  if (!creds) {
    return NextResponse.redirect(new URL('/mail?error=not_configured', req.nextUrl.origin))
  }

  const redirectUri = `${req.nextUrl.origin}/api/email/google/callback`
  const state = randomBytes(16).toString('hex')
  const res = NextResponse.redirect(buildAuthUrl(redirectUri, state, creds.clientId))
  res.cookies.set('gmail_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
