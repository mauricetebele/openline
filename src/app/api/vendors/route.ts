import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search')?.trim()

  const where = search
    ? {
        OR: [
          { name:    { contains: search, mode: 'insensitive' as const } },
          { contact: { contains: search, mode: 'insensitive' as const } },
          { email:   { contains: search, mode: 'insensitive' as const } },
          { phone:   { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {}

  const vendors = await prisma.vendor.findMany({
    where,
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({ data: vendors })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, contact, phone, email } = body

  if (!name?.trim()) return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })

  const vendor = await prisma.vendor.create({
    data: {
      name:    name.trim(),
      contact: contact?.trim() || null,
      phone:   phone?.trim()   || null,
      email:   email?.trim()   || null,
    },
  })

  return NextResponse.json(vendor, { status: 201 })
}
