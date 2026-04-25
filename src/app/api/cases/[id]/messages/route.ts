import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { sendCaseMessageNotification } from '@/lib/case-emails'

export const dynamic = 'force-dynamic'

// POST /api/cases/[id]/messages — add message
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

  // Only creator or tagged users can post
  const isCreator = c.createdById === user.dbId
  const isTagged = c.taggedUsers.some(tu => tu.userId === user.dbId)
  if (!isCreator && !isTagged) {
    return NextResponse.json({ error: 'You are not part of this case' }, { status: 403 })
  }

  const body = await req.json()
  const { body: messageBody } = body as { body?: string }

  if (!messageBody?.trim()) {
    return NextResponse.json({ error: 'Message body is required' }, { status: 400 })
  }

  const message = await prisma.caseMessage.create({
    data: {
      caseId: params.id,
      authorId: user.dbId,
      body: messageBody.trim(),
    },
    include: { author: { select: { id: true, name: true } } },
  })

  // Send email notifications fire-and-forget (exclude author)
  const recipients = c.taggedUsers
    .filter(tu => tu.userId !== user.dbId)
    .map(tu => ({ email: tu.user.email, name: tu.user.name }))

  // Also notify creator if they're not the author and not already tagged
  if (c.createdById !== user.dbId && !c.taggedUsers.some(tu => tu.userId === c.createdById)) {
    const creator = await prisma.user.findUnique({
      where: { id: c.createdById },
      select: { email: true, name: true },
    })
    if (creator) recipients.push({ email: creator.email, name: creator.name })
  }

  if (recipients.length > 0) {
    sendCaseMessageNotification(
      { id: c.id, caseNumber: c.caseNumber, title: c.title },
      messageBody.trim(),
      user.name,
      recipients,
    )
  }

  return NextResponse.json(message, { status: 201 })
}
