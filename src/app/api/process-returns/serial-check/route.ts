/**
 * GET /api/process-returns/serial-check?sn=<serial>
 * Lightweight read-only check for the Create Return form: does the serial
 * exist, and if so what's its SKU? Never mutates anything.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sn = req.nextUrl.searchParams.get('sn')?.trim()
  if (!sn) return NextResponse.json({ exists: false, sku: null })

  const serial = await prisma.inventorySerial.findFirst({
    where: { serialNumber: { equals: sn, mode: 'insensitive' } },
    select: { product: { select: { sku: true } }, grade: { select: { grade: true } } },
  })
  return NextResponse.json({
    exists: !!serial,
    sku: serial?.product?.sku ?? null,
    grade: serial?.grade?.grade ?? null,
  })
}
