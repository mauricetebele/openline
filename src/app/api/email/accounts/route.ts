/**
 * GET    /api/email/accounts     — list connected mailboxes
 * DELETE /api/email/accounts?id= — disconnect a mailbox
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { googleConfigured } from '@/lib/email/google'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.emailAccount.findMany({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, displayName: true, provider: true, createdAt: true },
  })
  return NextResponse.json({ accounts, configured: googleConfigured() })
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  await prisma.emailAccount.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
