/**
 * GET    /api/email/accounts     — mailboxes visible to the caller (admins: all; else: assigned to them)
 * PATCH  /api/email/accounts     — { accountId, assignedUserId } — admin assigns a mailbox to a user
 * DELETE /api/email/accounts?id= — disconnect a mailbox (admin or owner)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { googleConfigured } from '@/lib/email/google'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const isAdmin = user.role === 'ADMIN'

  const accounts = await prisma.emailAccount.findMany({
    where: { active: true, ...(isAdmin ? {} : { assignedUserId: user.dbId }) },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, email: true, displayName: true, provider: true, createdAt: true,
      assignedUserId: true,
      assignedUser: { select: { id: true, name: true, email: true } },
    },
  })
  return NextResponse.json({ accounts, configured: await googleConfigured(), isAdmin })
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Only an admin can assign mailboxes' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const accountId = String(body?.accountId ?? '').trim()
  const assignedUserId = body?.assignedUserId ? String(body.assignedUserId) : null
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })

  await prisma.emailAccount.update({ where: { id: accountId }, data: { assignedUserId } }).catch(() => {})
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const acct = await prisma.emailAccount.findUnique({ where: { id }, select: { assignedUserId: true } })
  if (!acct) return NextResponse.json({ ok: true })
  if (user.role !== 'ADMIN' && acct.assignedUserId !== user.dbId)
    return NextResponse.json({ error: 'Not your mailbox' }, { status: 403 })

  await prisma.emailAccount.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
