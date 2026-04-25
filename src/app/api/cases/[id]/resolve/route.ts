import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { sendCaseResolvedNotification } from '@/lib/case-emails'

export const dynamic = 'force-dynamic'

// POST /api/cases/[id]/resolve — resolve case
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const c = await prisma.case.findUnique({
    where: { id: params.id },
    include: {
      taggedUsers: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  })
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (c.status === 'RESOLVED') {
    return NextResponse.json({ error: 'Case is already resolved' }, { status: 400 })
  }

  // Only creator or tagged users can resolve
  const isCreator = c.createdById === user.dbId
  const isTagged = c.taggedUsers.some(tu => tu.userId === user.dbId)
  if (!isCreator && !isTagged) {
    return NextResponse.json({ error: 'You are not part of this case' }, { status: 403 })
  }

  const body = await req.json()
  const { resolutionNote } = body as { resolutionNote?: string }

  if (!resolutionNote?.trim()) {
    return NextResponse.json({ error: 'Resolution note is required' }, { status: 400 })
  }

  const updated = await prisma.case.update({
    where: { id: params.id },
    data: {
      status: 'RESOLVED',
      resolvedById: user.dbId,
      resolvedAt: new Date(),
      resolutionNote: resolutionNote.trim(),
    },
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

  // Send resolved notification to all tagged users (including resolver for confirmation)
  const recipients = c.taggedUsers
    .filter(tu => tu.userId !== user.dbId)
    .map(tu => ({ email: tu.user.email, name: tu.user.name }))

  // Also notify creator if not the resolver and not tagged
  if (c.createdById !== user.dbId && !c.taggedUsers.some(tu => tu.userId === c.createdById)) {
    const creator = await prisma.user.findUnique({
      where: { id: c.createdById },
      select: { email: true, name: true },
    })
    if (creator) recipients.push({ email: creator.email, name: creator.name })
  }

  if (recipients.length > 0) {
    sendCaseResolvedNotification(
      { id: c.id, caseNumber: c.caseNumber, title: c.title },
      user.name,
      resolutionNote.trim(),
      recipients,
    )
  }

  return NextResponse.json(updated)
}
