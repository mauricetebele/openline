import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { sendCaseCreatedNotification } from '@/lib/case-emails'

export const dynamic = 'force-dynamic'

// GET /api/cases — list cases
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const search = url.searchParams.get('search')?.trim() || ''
  const status = url.searchParams.get('status') || 'all'

  const conditions: Record<string, unknown>[] = []

  if (status === 'UNRESOLVED' || status === 'RESOLVED') {
    conditions.push({ status })
  }

  if (search) {
    const num = parseInt(search, 10)
    conditions.push({
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        ...(Number.isFinite(num) ? [{ caseNumber: num }] : []),
      ],
    })
  }

  // RESOLUTION_PROVIDER can only see cases they created or are tagged in
  if (user.role === 'RESOLUTION_PROVIDER') {
    conditions.push({
      OR: [
        { createdById: user.dbId },
        { taggedUsers: { some: { userId: user.dbId } } },
      ],
    })
  }

  const where = conditions.length > 0 ? { AND: conditions } : {}

  const cases = await prisma.case.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      taggedUsers: { include: { user: { select: { id: true, name: true } } } },
      _count: { select: { messages: true } },
    },
  })

  return NextResponse.json({ data: cases })
}

// POST /api/cases — create case
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, description, taggedUserIds } = body as {
    title?: string
    description?: string
    taggedUserIds?: string[]
  }

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const created = await prisma.case.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      createdById: user.dbId,
      taggedUsers: {
        create: (taggedUserIds ?? []).map(uid => ({ userId: uid })),
      },
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      taggedUsers: { include: { user: { select: { id: true, name: true, email: true } } } },
      _count: { select: { messages: true } },
    },
  })

  // Notify tagged users about the new case
  const recipients = created.taggedUsers
    .filter(tu => tu.userId !== user.dbId)
    .map(tu => ({ email: tu.user.email, name: tu.user.name }))

  if (recipients.length > 0) {
    sendCaseCreatedNotification(
      { id: created.id, caseNumber: created.caseNumber, title: created.title },
      user.name,
      created.description,
      recipients,
    )
  }

  return NextResponse.json(created, { status: 201 })
}
