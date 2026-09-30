/**
 * POST /api/auth/session  — verify Firebase ID token, issue a JWT session cookie
 * GET  /api/auth/session  — return current user info (for mobile session validation)
 * DELETE /api/auth/session — clear the session cookie (logout)
 *
 * Uses Firebase REST API to validate the ID token — no service account key needed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { signSessionToken, sessionCookieOpts, roleCookieOpts } from '@/lib/session'

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ user })
}

export async function POST(req: NextRequest) {
  const { idToken } = await req.json()
  if (!idToken) return NextResponse.json({ error: 'Missing idToken' }, { status: 400 })

  try {
    // Verify the ID token by calling Firebase's getAccountInfo endpoint
    const firebaseRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    )

    if (!firebaseRes.ok) {
      console.error('Firebase token verification failed:', await firebaseRes.text())
      return NextResponse.json({ error: 'Invalid ID token' }, { status: 401 })
    }

    const data = await firebaseRes.json()
    const fbUser = data.users?.[0]
    if (!fbUser) {
      return NextResponse.json({ error: 'Invalid ID token' }, { status: 401 })
    }

    // Sign our own session JWT
    const sessionToken = signSessionToken({
      uid: fbUser.localId,
      email: fbUser.email,
      name: fbUser.displayName ?? fbUser.email?.split('@')[0] ?? '',
    })

    // Look up DB user to get role for routing
    const { prisma } = await import('@/lib/prisma')
    const dbUser = await prisma.user.findUnique({
      where: { firebaseUid: fbUser.localId },
      select: { role: true },
    })
    const role = dbUser?.role ?? 'REVIEWER'

    const res = NextResponse.json({ ok: true, token: idToken, role })
    res.cookies.set('__session', sessionToken, sessionCookieOpts)
    res.cookies.set('__role', role, roleCookieOpts) // non-httpOnly, for middleware routing
    return res
  } catch (err) {
    console.error('Session creation error:', err)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('__session', '', { maxAge: 0, path: '/' })
  res.cookies.set('__role', '', { maxAge: 0, path: '/' })
  return res
}
