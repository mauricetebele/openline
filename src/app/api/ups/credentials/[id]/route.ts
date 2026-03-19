/**
 * PATCH  /api/ups/credentials/:id  — update nickname or toggle default
 * DELETE /api/ups/credentials/:id  — soft-deactivate an account
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as { nickname?: string; isDefault?: boolean }

  const cred = await prisma.upsCredential.findFirst({ where: { id, isActive: true } })
  if (!cred) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  // If setting as default, unset previous default in a transaction
  if (body.isDefault === true) {
    await prisma.$transaction([
      prisma.upsCredential.updateMany({ where: { isDefault: true, isActive: true }, data: { isDefault: false } }),
      prisma.upsCredential.update({ where: { id }, data: { isDefault: true, ...(body.nickname?.trim() ? { nickname: body.nickname.trim() } : {}) } }),
    ])
  } else {
    const data: Record<string, unknown> = {}
    if (body.nickname?.trim()) data.nickname = body.nickname.trim()
    if (Object.keys(data).length > 0) {
      await prisma.upsCredential.update({ where: { id }, data })
    }
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const cred = await prisma.upsCredential.findFirst({ where: { id, isActive: true } })
  if (!cred) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  // Block deleting the default if other active accounts exist
  if (cred.isDefault) {
    const otherCount = await prisma.upsCredential.count({ where: { isActive: true, id: { not: id } } })
    if (otherCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete the default account while other accounts exist. Set another account as default first.' },
        { status: 400 },
      )
    }
  }

  await prisma.upsCredential.update({ where: { id }, data: { isActive: false } })

  return NextResponse.json({ success: true })
}
