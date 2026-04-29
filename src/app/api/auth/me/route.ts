/**
 * GET /api/auth/me
 * Returns the current user from the session cookie, or 401.
 * Used by AuthContext to restore auth state on page load.
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    dbId: user.dbId,
    canAccessOli: user.canAccessOli,
    canViewPurchaseOrders: user.canViewPurchaseOrders,
    vendorId: user.vendorId,
  })
}
