/**
 * PUT    /api/shipping-presets/[id]  — update a preset (admin only)
 * DELETE /api/shipping-presets/[id]  — delete a preset (admin only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  name:         z.string().min(1).optional(),
  carrierCode:  z.string().min(1).optional(),
  serviceCode:  z.string().optional().nullable(),
  packageCode:  z.string().optional().nullable(),
  weightValue:  z.number().positive().optional(),
  weightUnit:   z.enum(['ounces', 'pounds', 'grams', 'kilograms']).optional(),
  dimLength:    z.number().positive().optional().nullable(),
  dimWidth:     z.number().positive().optional().nullable(),
  dimHeight:    z.number().positive().optional().nullable(),
  dimUnit:      z.enum(['inches', 'centimeters']).optional(),
  confirmation:      z.enum(['none', 'delivery', 'signature', 'adult_signature']).optional().nullable(),
  insuredValue:      z.number().positive().optional().nullable(),
  insuranceProvider: z.enum(['parcelguard', 'carrier']).optional().nullable(),
  upsCredentialId:   z.string().optional().nullable(),
  isDefault:         z.boolean().optional(),
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
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }

  const existing = await prisma.shippingPreset.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Preset not found' }, { status: 404 })

  if (parsed.data.isDefault) {
    await prisma.shippingPreset.updateMany({
      where: { isDefault: true, id: { not: params.id } },
      data: { isDefault: false },
    })
  }

  const preset = await prisma.shippingPreset.update({ where: { id: params.id }, data: parsed.data })
  return NextResponse.json(preset)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const existing = await prisma.shippingPreset.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Preset not found' }, { status: 404 })

  await prisma.shippingPreset.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
