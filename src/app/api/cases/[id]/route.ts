import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

// GET /api/cases/[id] — case detail
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const c = await prisma.case.findUnique({
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

  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // RESOLUTION_PROVIDER can only access cases they created or are tagged in
  if (user.role === 'RESOLUTION_PROVIDER') {
    const isInvolved = c.createdBy.id === user.dbId ||
      c.taggedUsers.some(tu => tu.user.id === user.dbId)
    if (!isInvolved) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(c)
}

// PATCH /api/cases/[id] — update case (title/description by creator; marketplaceCaseIds by any participant)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.case.findUnique({
    where: { id: params.id },
    select: { createdById: true, taggedUsers: { select: { userId: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isCreator = existing.createdById === user.dbId
  const isTagged = existing.taggedUsers.some(tu => tu.userId === user.dbId)
  if (!isCreator && !isTagged) {
    return NextResponse.json({ error: 'You are not part of this case' }, { status: 403 })
  }

  const body = await req.json()
  const data: Record<string, unknown> = {}

  // Title/description — creator only
  if (body.title !== undefined || body.description !== undefined) {
    if (!isCreator) {
      return NextResponse.json({ error: 'Only the creator can edit title/description' }, { status: 403 })
    }
    if (body.title !== undefined) data.title = body.title?.trim() || undefined
    if (body.description !== undefined) data.description = body.description?.trim() || null
  }

  // Marketplace case IDs — any participant
  if (body.marketplaceCaseIds !== undefined) {
    data.marketplaceCaseIds = Array.isArray(body.marketplaceCaseIds) ? body.marketplaceCaseIds : []
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.case.update({
    where: { id: params.id },
    data,
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

// DELETE /api/cases/[id] — admin-only case deletion
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const existing = await prisma.case.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.case.delete({ where: { id: params.id } })

  return NextResponse.json({ success: true })
}
