/**
 * GET  /api/shipping-presets  — list all presets
 * POST /api/shipping-presets  — create a new preset (admin only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

const presetSchema = z.object({
  name:         z.string().min(1),
  carrierCode:  z.string().min(1),
  serviceCode:  z.string().optional().nullable(),
  packageCode:  z.string().optional().nullable(),
  weightValue:  z.number().positive(),
  weightUnit:   z.enum(['ounces', 'pounds', 'grams', 'kilograms']).default('ounces'),
  dimLength:    z.number().positive().optional().nullable(),
  dimWidth:     z.number().positive().optional().nullable(),
  dimHeight:    z.number().positive().optional().nullable(),
  dimUnit:      z.enum(['inches', 'centimeters']).default('inches'),
  confirmation: z.enum(['none', 'delivery', 'signature', 'adult_signature']).optional().nullable(),
  isDefault:    z.boolean().default(false),
})

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const presets = await prisma.shippingPreset.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json(presets)
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = presetSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }

  // If isDefault is being set to true, clear existing defaults first
  if (parsed.data.isDefault) {
    await prisma.shippingPreset.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
  }

  const preset = await prisma.shippingPreset.create({ data: parsed.data })
  return NextResponse.json(preset, { status: 201 })
}
