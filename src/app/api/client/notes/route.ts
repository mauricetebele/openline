import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user || user.role !== 'CLIENT')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const notes = await prisma.clientNote.findMany({
    where: { userId: user.dbId },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(notes)
}

export async function POST(req: Request) {
  const user = await getAuthUser()
  if (!user || user.role !== 'CLIENT')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { body } = await req.json()
  if (!body || typeof body !== 'string' || !body.trim())
    return NextResponse.json({ error: 'Body is required' }, { status: 400 })

  const note = await prisma.clientNote.create({
    data: { userId: user.dbId, body: body.trim() },
  })

  return NextResponse.json(note, { status: 201 })
}
