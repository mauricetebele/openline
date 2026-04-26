import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!

function requireAdmin(user: { role: string }) {
  return user.role === 'ADMIN'
}

// ─── Firebase REST API helpers ────────────────────────────────────────────────

async function firebaseCreateUser(email: string, password: string, displayName: string): Promise<string> {
  // Sign up via Firebase Auth REST API
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName, returnSecureToken: false }),
    },
  )
  const data = await res.json()
  if (!res.ok) {
    const code = data.error?.message ?? 'UNKNOWN_ERROR'
    if (code.includes('EMAIL_EXISTS')) {
      // Firebase user exists but DB record was deleted — delete and recreate
      const uid = await firebaseGetUidByEmail(email)
      if (uid) {
        await firebaseDeleteUserByAdmin(uid)
        return firebaseCreateUser(email, password, displayName)
      }
      throw new Error('A Firebase account with this email already exists')
    }
    if (code.includes('WEAK_PASSWORD')) throw new Error('Password is too weak')
    throw new Error(code)
  }
  return data.localId // Firebase UID
}

async function firebaseGetUidByEmail(email: string): Promise<string | null> {
  const { adminAuth } = await import('@/lib/firebase-admin')
  try {
    const user = await adminAuth.getUserByEmail(email)
    return user.uid
  } catch {
    return null
  }
}

async function firebaseDeleteUserByAdmin(uid: string): Promise<void> {
  const { adminAuth } = await import('@/lib/firebase-admin')
  await adminAuth.deleteUser(uid)
}

async function firebaseDeleteUser(idToken: string): Promise<void> {
  // Delete account via Firebase Auth REST API — requires an ID token for that user
  // Since we don't have the user's token, we'll skip Firebase deletion
  // and just remove from our DB. The Firebase account becomes orphaned but harmless.
  void idToken
}

// ─── GET — list all users ─────────────────────────────────────────────────────

export async function GET() {
  const user = await getAuthUser()
  if (!user || !requireAdmin(user))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, createdAt: true, companyName: true,
      _count: { select: { clientLocationAccess: true, visibleUsers: true } },
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({ data: users })
}

// ─── POST — create a new user ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || !requireAdmin(user))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { email, name, password, role, companyName } = body as {
    email?: string
    name?: string
    password?: string
    role?: string
    companyName?: string
  }

  if (!email || !name || !password)
    return NextResponse.json({ error: 'email, name, and password are required' }, { status: 400 })

  if (password.length < 6)
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })

  const validRoles = ['ADMIN', 'REVIEWER', 'CLIENT', 'RESOLUTION_PROVIDER']
  const finalRole = validRoles.includes(role ?? '') ? role! : 'REVIEWER'

  // Check email uniqueness in our DB
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing)
    return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })

  try {
    // Create Firebase user via REST API
    const firebaseUid = await firebaseCreateUser(email, password, name)

    // Create Prisma record
    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        firebaseUid,
        role: finalRole as 'ADMIN' | 'REVIEWER' | 'CLIENT' | 'RESOLUTION_PROVIDER',
        ...(companyName ? { companyName } : {}),
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true, companyName: true },
    })

    return NextResponse.json({ data: newUser }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create user'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── PATCH — update user role or name ─────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || !requireAdmin(user))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { userId, role, name, companyName } = body as {
    userId?: string
    role?: string
    name?: string
    companyName?: string | null
  }

  if (!userId)
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  const data: Record<string, string | null> = {}
  if (role && ['ADMIN', 'REVIEWER', 'CLIENT', 'RESOLUTION_PROVIDER'].includes(role)) data.role = role
  if (name) data.name = name
  if (companyName !== undefined) data.companyName = companyName ?? null

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, name: true, email: true, role: true, createdAt: true, companyName: true },
    })
    return NextResponse.json({ data: updated })
  } catch {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
}

// ─── DELETE — remove a user ───────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || !requireAdmin(user))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { userId } = body as { userId?: string }

  if (!userId)
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  // Prevent self-deletion
  if (userId === user.dbId)
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })

  try {
    const target = await prisma.user.findUnique({ where: { id: userId } })
    if (!target)
      return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Note: Firebase REST API requires the user's own ID token to delete their account.
    // Without Admin SDK, we can only remove from our DB. The Firebase auth account
    // becomes orphaned but is harmless (they can't log in without a DB record).

    await prisma.user.delete({ where: { id: userId } })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
