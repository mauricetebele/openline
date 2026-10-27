/**
 * PATCH  /api/bm-cases/:id  { caseId?, orderId?, description?, caseUrl?, status? }
 *   Updates editable fields and/or transitions status (OPEN | RESOLVED).
 *   Moving to RESOLVED stamps resolvedAt; moving back to OPEN clears it.
 *
 * DELETE /api/bm-cases/:id — removes a case.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  caseId:      z.string().trim().min(1).optional(),
  orderId:     z.string().trim().optional().nullable(),
  description: z.string().trim().min(1).optional(),
  caseUrl:     z.string().trim().url('Case URL must be a valid URL').optional().nullable().or(z.literal('')),
  status:      z.enum(['OPEN', 'RESOLVED']).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
  }
  const b = parsed.data

  const existing = await prisma.bmCase.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: Prisma.BmCaseUpdateInput = { updatedBy: user.email }
  if (b.caseId !== undefined)      data.caseId = b.caseId
  if (b.orderId !== undefined)     data.orderId = b.orderId?.trim() || null
  if (b.description !== undefined) data.description = b.description
  if (b.caseUrl !== undefined)     data.caseUrl = b.caseUrl?.trim() || null
  if (b.status !== undefined) {
    data.status = b.status
    data.resolvedAt = b.status === 'RESOLVED' ? (existing.resolvedAt ?? new Date()) : null
  }

  const updated = await prisma.bmCase.update({ where: { id }, data })
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.bmCase.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.bmCase.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
