import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, contact, phone, email } = body

  if (!name?.trim()) return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })

  const vendor = await prisma.vendor.update({
    where: { id: params.id },
    data: {
      name:    name.trim(),
      contact: contact?.trim() || null,
      phone:   phone?.trim()   || null,
      email:   email?.trim()   || null,
    },
  })

  return NextResponse.json(vendor)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.vendor.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
