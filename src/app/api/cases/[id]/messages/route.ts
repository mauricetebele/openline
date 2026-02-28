import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { body: messageBody } = body

  if (!messageBody?.trim()) {
    return NextResponse.json({ error: 'Message body is required' }, { status: 400 })
  }

  // Verify case exists
  const caseExists = await prisma.case.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!caseExists) return NextResponse.json({ error: 'Case not found' }, { status: 404 })

  const message = await prisma.caseMessage.create({
    data: {
      caseId: params.id,
      authorId: user.dbId,
      body: messageBody.trim(),
    },
    include: {
      author: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json(message, { status: 201 })
}
