/**
 * GET /api/admin/google-auth/connect — start OAuth so an admin authorizes
 * password-setting with their own Google account (no service-account key).
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAuthUser } from '@/lib/get-auth-user'
import { getGoogleCreds } from '@/lib/email/google'
import { buildAdminAuthUrl } from '@/lib/gcip-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || user.role !== 'ADMIN') return NextResponse.redirect(new URL('/settings?section=users', req.nextUrl.origin))

  const creds = await getGoogleCreds()
  if (!creds) return NextResponse.redirect(new URL('/settings?section=users&adminauth=no_oauth', req.nextUrl.origin))

  const redirectUri = `${req.nextUrl.origin}/api/admin/google-auth/callback`
  const state = randomBytes(16).toString('hex')
  const res = NextResponse.redirect(buildAdminAuthUrl(redirectUri, state, creds.clientId))
  res.cookies.set('gcip_admin_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
