import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const rc = await prisma.fbaRemovalCase.findUnique({
    where: { id },
    include: { createdBy: { select: { name: true } } },
  })

  if (!rc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rc)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const data: Record<string, unknown> = {}
  if ('note' in body) data.note = body.note || null
  if ('images' in body) data.images = body.images

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.fbaRemovalCase.update({
    where: { id },
    data,
    include: { createdBy: { select: { name: true } } },
  })

  return NextResponse.json(updated)
}
