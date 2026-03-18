import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.user.update({
    where: { id: user.dbId },
    data: { lastSeenAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
