/**
 * Call this at the top of every API route to get the verified user.
 * Returns null if the session cookie is missing or invalid.
 *
 * Supports two auth methods:
 *   1. Bearer token (Authorization header) — Firebase ID token verified via Admin SDK
 *   2. Session cookie (__session) — JWT verified with SESSION_SECRET
 *
 * Usage:
 *   const user = await getAuthUser()
 *   if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 */
import { cookies, headers } from 'next/headers'
import jwt from 'jsonwebtoken'
import { prisma } from './prisma'
import { adminAuth } from './firebase-admin'

const SESSION_SECRET = process.env.SESSION_SECRET!

export interface AuthUser {
  uid: string
  email: string
  dbId: string       // our internal User.id
  role: string       // ADMIN | REVIEWER | CLIENT | RESOLUTION_PROVIDER | VENDOR
  name: string
  canAccessOli: boolean
  canViewPurchaseOrders: boolean
  vendorId: string | null
}

async function resolveDbUser(decoded: { uid: string; email: string; name: string }): Promise<AuthUser | null> {
  let user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })

  if (!user) {
    user = await prisma.user.upsert({
      where: { email: decoded.email },
      update: { firebaseUid: decoded.uid },
      create: {
        email: decoded.email,
        firebaseUid: decoded.uid,
        name: decoded.name ?? decoded.email.split('@')[0],
        role: 'REVIEWER',
      },
    })
  }

  return {
    uid: decoded.uid,
    email: decoded.email,
    dbId: user.id,
    role: user.role,
    name: user.name,
    canAccessOli: user.canAccessOli,
    canViewPurchaseOrders: user.canViewPurchaseOrders,
    vendorId: user.vendorId ?? null,
  }
}

export async function getAuthUser(): Promise<AuthUser | null> {
  // 1. Check for Bearer token (mobile app / API clients)
  const headerStore = headers()
  const authHeader = headerStore.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const idToken = authHeader.slice(7)
    try {
      const fbUser = await adminAuth.verifyIdToken(idToken)
      return resolveDbUser({
        uid: fbUser.uid,
        email: fbUser.email ?? '',
        name: fbUser.name ?? fbUser.email?.split('@')[0] ?? '',
      })
    } catch {
      // Invalid or expired Firebase ID token — don't fall through to cookie
      return null
    }
  }

  // 2. Fall back to session cookie (web app)
  const cookieStore = cookies()
  const sessionCookie = cookieStore.get('__session')?.value

  if (!sessionCookie) return null

  try {
    const decoded = jwt.verify(sessionCookie, SESSION_SECRET) as {
      uid: string
      email: string
      name: string
    }

    return resolveDbUser(decoded)
  } catch {
    // Token expired, tampered, or wrong secret
    return null
  }
}
