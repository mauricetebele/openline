/**
 * PUT    /api/package-presets/[id]  — update a package preset
 * DELETE /api/package-presets/[id]  — delete a package preset
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  name:         z.string().min(1).max(80).optional(),
  packageCode:  z.string().optional().nullable(),
  weightValue:  z.number().positive().optional(),
  weightUnit:   z.enum(['ounces', 'pounds', 'grams', 'kilograms']).optional(),
  dimLength:    z.number().positive().optional().nullable(),
  dimWidth:     z.number().positive().optional().nullable(),
  dimHeight:    z.number().positive().optional().nullable(),
  dimUnit:      z.enum(['inches', 'centimeters']).optional(),
  confirmation: z.string().optional().nullable(),
  isDefault:    z.boolean().optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const data = parsed.data

  if (data.isDefault) {
    await prisma.packagePreset.updateMany({
      where: { isDefault: true, NOT: { id: params.id } },
      data:  { isDefault: false },
    })
  }

  const preset = await prisma.packagePreset.update({
    where: { id: params.id },
    data,
  })

  return NextResponse.json(preset)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  await prisma.packagePreset.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
