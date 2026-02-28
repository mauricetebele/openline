/**
 * Call this at the top of every API route to get the verified user.
 * Returns null if the session cookie is missing or invalid.
 *
 * Usage:
 *   const user = await getAuthUser()
 *   if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 */
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'
import { prisma } from './prisma'

const SESSION_SECRET = process.env.SESSION_SECRET!

export interface AuthUser {
  uid: string
  email: string
  dbId: string       // our internal User.id
  role: string       // ADMIN | REVIEWER
  name: string
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = cookies()
  const sessionCookie = cookieStore.get('__session')?.value

  if (!sessionCookie) return null

  try {
    const decoded = jwt.verify(sessionCookie, SESSION_SECRET) as {
      uid: string
      email: string
      name: string
    }

    // Ensure a matching User row exists in our DB (created on first login)
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
    }
  } catch {
    // Token expired, tampered, or wrong secret
    return null
  }
}
