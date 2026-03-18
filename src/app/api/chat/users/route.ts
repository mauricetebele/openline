import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

// GET — all users except self (for new conversation picker)
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const users = await prisma.user.findMany({
    where: { id: { not: user.dbId } },
    select: { id: true, name: true, email: true, lastSeenAt: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(users)
}
