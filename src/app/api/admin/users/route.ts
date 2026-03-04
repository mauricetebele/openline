import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { adminAuth } from '@/lib/firebase-admin'

export const dynamic = 'force-dynamic'

function requireAdmin(user: { role: string }) {
  return user.role === 'ADMIN'
}

// ─── GET — list all users ─────────────────────────────────────────────────────

export async function GET() {
  const user = await getAuthUser()
  if (!user || !requireAdmin(user))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
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
  const { email, name, password, role } = body as {
    email?: string
    name?: string
    password?: string
    role?: string
  }

  if (!email || !name || !password)
    return NextResponse.json({ error: 'email, name, and password are required' }, { status: 400 })

  if (password.length < 6)
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })

  const validRoles = ['ADMIN', 'REVIEWER']
  const finalRole = validRoles.includes(role ?? '') ? role! : 'REVIEWER'

  // Check email uniqueness in our DB
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing)
    return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })

  try {
    // Create Firebase user
    const fbUser = await adminAuth.createUser({
      email,
      password,
      displayName: name,
    })

    // Create Prisma record
    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        firebaseUid: fbUser.uid,
        role: finalRole as 'ADMIN' | 'REVIEWER',
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
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
  const { userId, role, name } = body as {
    userId?: string
    role?: string
    name?: string
  }

  if (!userId)
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  const data: Record<string, string> = {}
  if (role && ['ADMIN', 'REVIEWER'].includes(role)) data.role = role
  if (name) data.name = name

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
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

    // Delete from Firebase if they have a Firebase UID
    if (target.firebaseUid) {
      try {
        await adminAuth.deleteUser(target.firebaseUid)
      } catch {
        // Firebase user may already be deleted — continue with DB cleanup
      }
    }

    await prisma.user.delete({ where: { id: userId } })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
