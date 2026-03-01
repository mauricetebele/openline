import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

/** DELETE /api/accounts/:id — remove a connected Amazon account */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const { id } = params

  try {
    await prisma.amazonAccount.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }
}
