/**
 * GET /api/auth/me
 * Returns the current user from the session cookie, or 401.
 * Used by AuthContext to restore auth state on page load.
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { signSessionToken, sessionCookieOpts, roleCookieOpts } from '@/lib/session'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const res = NextResponse.json({
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    dbId: user.dbId,
    canAccessOli: user.canAccessOli,
    canAccessMail: user.canAccessMail,
    canViewPurchaseOrders: user.canViewPurchaseOrders,
    vendorId: user.vendorId,
  })
  // Sliding session: renew the cookie window on each app load so an active user is
  // never surprise-logged-out mid-use. Best-effort — a signing hiccup must not 401.
  try {
    res.cookies.set('__session', signSessionToken({ uid: user.uid, email: user.email, name: user.name }), sessionCookieOpts)
    res.cookies.set('__role', user.role, roleCookieOpts)
  } catch { /* leave the existing cookie in place */ }
  return res
}
