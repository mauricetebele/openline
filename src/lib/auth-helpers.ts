/**
 * Shared authorization helpers for API routes.
 *
 * Usage in a route handler:
 *   const user = await getAuthUser()
 *   if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 *   const adminErr = requireAdmin(user)
 *   if (adminErr) return adminErr
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { AuthUser } from '@/lib/get-auth-user'
import type { AmazonAccount } from '@prisma/client'

/**
 * Returns a 403 response if the user is not an ADMIN, otherwise returns null.
 * Call this after getAuthUser() to gate admin-only operations.
 */
export function requireAdmin(user: AuthUser): NextResponse | null {
  if (user.role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden: admin access required' },
      { status: 403 },
    )
  }
  return null
}

/**
 * Looks up an Amazon account by ID and verifies it is active.
 * Returns the account on success, or a NextResponse error on failure.
 */
export async function requireActiveAccount(
  accountId: string,
): Promise<AmazonAccount | NextResponse> {
  const account = await prisma.amazonAccount.findUnique({
    where: { id: accountId, isActive: true },
  })
  if (!account) {
    return NextResponse.json(
      { error: 'Amazon account not found or inactive' },
      { status: 404 },
    )
  }
  return account
}
