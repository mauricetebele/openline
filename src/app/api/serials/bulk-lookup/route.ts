import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const serials: string[] = body?.serials

  if (!Array.isArray(serials) || serials.length === 0) {
    return NextResponse.json({ error: 'serials array is required' }, { status: 400 })
  }

  // Deduplicate and clean
  const cleaned = Array.from(new Set(serials.map((s: string) => s.trim()).filter(Boolean)))

  const found = await prisma.inventorySerial.findMany({
    where: {
      serialNumber: { in: cleaned, mode: 'insensitive' },
      product: { isSerializable: true },
    },
    include: {
      product:  { select: { id: true, description: true, sku: true } },
      location: { include: { warehouse: { select: { id: true, name: true } } } },
      grade:    { select: { id: true, grade: true } },
    },
  })

  const foundLower = new Set(found.map(s => s.serialNumber.toLowerCase()))
  const notFound   = cleaned.filter(s => !foundLower.has(s.toLowerCase()))

  return NextResponse.json({ found, notFound })
}
