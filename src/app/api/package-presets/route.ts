/**
 * GET  /api/package-presets   — list all package presets
 * POST /api/package-presets   — create a new package preset
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  name:         z.string().min(1).max(80),
  packageCode:  z.string().optional().nullable(),
  weightValue:  z.number().positive(),
  weightUnit:   z.enum(['ounces', 'pounds', 'grams', 'kilograms']).default('ounces'),
  dimLength:    z.number().positive().optional().nullable(),
  dimWidth:     z.number().positive().optional().nullable(),
  dimHeight:    z.number().positive().optional().nullable(),
  dimUnit:      z.enum(['inches', 'centimeters']).default('inches'),
  confirmation: z.string().optional().nullable(),
  isDefault:    z.boolean().default(false),
})

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const presets = await prisma.packagePreset.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json(presets)
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const data = parsed.data

  // If isDefault, unset any existing default first
  if (data.isDefault) {
    await prisma.packagePreset.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
  }

  const preset = await prisma.packagePreset.create({ data })
  return NextResponse.json(preset, { status: 201 })
}
