/**
 * Shared session-cookie helpers so the login route and the sliding-renewal in
 * /api/auth/me stay in lockstep. The `__session` JWT is our own (verified with
 * SESSION_SECRET); it is renewed on each app load so active users stay signed in.
 */
import jwt from 'jsonwebtoken'

const SESSION_SECRET = process.env.SESSION_SECRET!
// 30-day window, slid forward on activity (see /api/auth/me).
export const SESSION_DURATION_S = 60 * 60 * 24 * 30

export function signSessionToken(p: { uid: string; email: string; name: string }): string {
  return jwt.sign({ uid: p.uid, email: p.email, name: p.name }, SESSION_SECRET, { expiresIn: SESSION_DURATION_S })
}

export const sessionCookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: SESSION_DURATION_S,
  path: '/',
}

// Non-httpOnly companion cookie the (edge) middleware reads for role routing.
export const roleCookieOpts = {
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: SESSION_DURATION_S,
  path: '/',
}
