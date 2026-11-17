/**
 * PATCH  /api/warehouse-supplies/[id] — update name/status/warehouseNote/adminNote
 * DELETE /api/warehouse-supplies/[id] — delete a supply product
 *
 * Notes can be added, edited, or cleared at any time: send the field as a string
 * (empty string clears it). Omitted fields are left unchanged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma, SupplyStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

const STATUSES = Object.values(SupplyStatus)

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const data: Prisma.WarehouseSupplyUpdateInput = {}

  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    data.name = name
  }
  if (body?.status !== undefined) {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    data.status = body.status
  }
  if (typeof body?.warehouseNote === 'string') data.warehouseNote = body.warehouseNote.trim() || null
  if (typeof body?.adminNote === 'string') data.adminNote = body.adminNote.trim() || null

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  try {
    const updated = await prisma.warehouseSupply.update({ where: { id: params.id }, data })
    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: 'Supply not found' }, { status: 404 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await prisma.warehouseSupply.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Supply not found' }, { status: 404 })
  }
}
