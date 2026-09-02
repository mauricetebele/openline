/**
 * GET   /api/process-returns/[id]  — one staged return
 * PATCH /api/process-returns/[id]  — administrator: set note-to-processor + flag
 *
 * Staging only — never affects inventory.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ret = await prisma.processReturn.findUnique({
    where: { id: params.id },
    include: { units: { orderBy: { createdAt: 'asc' } } },
  })
  if (!ret) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: ret })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const data: {
    adminNote?: string | null
    flagged?: boolean
    adminNoteByLabel?: string | null
    adminNoteAt?: Date
  } = {}

  if ('adminNote' in body) {
    data.adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim() || null : null
    data.adminNoteByLabel = user.name || user.email
    data.adminNoteAt = new Date()
  }
  if ('flagged' in body) data.flagged = !!body.flagged

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const updated = await prisma.processReturn.update({
    where: { id: params.id },
    data,
    include: { units: { orderBy: { createdAt: 'asc' } } },
  })
  return NextResponse.json({ data: updated })
}
