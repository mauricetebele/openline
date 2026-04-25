import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

// POST /api/cases/[id]/tag — add tagged users
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const c = await prisma.case.findUnique({
    where: { id: params.id },
    select: { createdById: true },
  })
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (c.createdById !== user.dbId) {
    return NextResponse.json({ error: 'Only the creator can add tagged users' }, { status: 403 })
  }

  const body = await req.json()
  const { userIds } = body as { userIds?: string[] }

  if (!userIds?.length) {
    return NextResponse.json({ error: 'userIds is required' }, { status: 400 })
  }

  // Upsert to avoid duplicates
  await Promise.all(
    userIds.map(uid =>
      prisma.caseTaggedUser.upsert({
        where: { caseId_userId: { caseId: params.id, userId: uid } },
        update: {},
        create: { caseId: params.id, userId: uid },
      }),
    ),
  )

  const updated = await prisma.case.findUnique({
    where: { id: params.id },
    include: {
      createdBy: { select: { id: true, name: true } },
      resolvedBy: { select: { id: true, name: true } },
      taggedUsers: { include: { user: { select: { id: true, name: true, email: true } } } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true } } },
      },
    },
  })

  return NextResponse.json(updated)
}
