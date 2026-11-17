/**
 * GET  /api/warehouse-supplies — list all supply products
 * POST /api/warehouse-supplies — create a supply product
 */
import { NextRequest, NextResponse } from 'next/server'
import { SupplyStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

const STATUSES = Object.values(SupplyStatus)

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supplies = await prisma.warehouseSupply.findMany({
    orderBy: [{ name: 'asc' }],
  })
  return NextResponse.json({ data: supplies })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const status: SupplyStatus = STATUSES.includes(body?.status) ? body.status : 'AMPLE'

  const supply = await prisma.warehouseSupply.create({
    data: {
      name,
      status,
      warehouseNote: typeof body?.warehouseNote === 'string' && body.warehouseNote.trim() ? body.warehouseNote.trim() : null,
      adminNote: typeof body?.adminNote === 'string' && body.adminNote.trim() ? body.adminNote.trim() : null,
      createdByLabel: user.name || user.email,
    },
  })
  return NextResponse.json(supply, { status: 201 })
}
