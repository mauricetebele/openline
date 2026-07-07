import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let action: string | undefined
  try {
    const body = await req.json()
    action = body.action
  } catch {
    // no body = default validate
  }

  const updated = await prisma.amazonTransaction.update({
    where: { id },
    data: {
      validatedAt: action === 'unvalidate' ? null : new Date(),
    },
  })

  return NextResponse.json(updated)
}
