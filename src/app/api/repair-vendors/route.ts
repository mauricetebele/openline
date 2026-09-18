/**
 * GET  /api/repair-vendors  — list vendors
 * POST /api/repair-vendors  — create a vendor { companyName, email?, phone?, address... }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const vendors = await prisma.repairVendor.findMany({ orderBy: { companyName: 'asc' } })
  return NextResponse.json(vendors)
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const companyName = typeof b?.companyName === 'string' ? b.companyName.trim() : ''
  if (!companyName) return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
  const s = (k: string) => (typeof b?.[k] === 'string' && b[k].trim() ? b[k].trim() : null)
  const vendor = await prisma.repairVendor.create({
    data: {
      companyName, email: s('email'), phone: s('phone'),
      address1: s('address1'), address2: s('address2'), city: s('city'),
      state: s('state'), postal: s('postal'), country: s('country') || 'US',
    },
  })
  return NextResponse.json(vendor, { status: 201 })
}
