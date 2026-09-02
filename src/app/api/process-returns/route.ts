/**
 * GET  /api/process-returns  — list staged returns (newest first)
 * POST /api/process-returns  — create a staged return
 *
 * PROCESS RETURNS is a warehouse staging log so the RMA processor can log
 * received returns and communicate with the administrator. It is purely
 * informational: it NEVER touches inventory serials, quantities, or movement.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const returns = await prisma.processReturn.findMany({
    orderBy: [{ flagged: 'desc' }, { createdAt: 'desc' }],
    include: { units: { orderBy: { createdAt: 'asc' } } },
  })
  return NextResponse.json({ data: returns })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const trackingNumber = String(body?.trackingNumber ?? '').trim()
  const carrier = String(body?.carrier ?? '').trim()
  const note = typeof body?.note === 'string' ? body.note.trim() || null : null
  const rawUnits: unknown[] = Array.isArray(body?.units) ? body.units : []

  if (!trackingNumber) return NextResponse.json({ error: 'Tracking number is required' }, { status: 400 })
  if (!carrier) return NextResponse.json({ error: 'Carrier is required' }, { status: 400 })

  const units = rawUnits
    .map(u => {
      const uu = u as { serialNumber?: unknown; grade?: unknown }
      return {
        serialNumber: String(uu.serialNumber ?? '').trim(),
        grade: uu.grade != null && String(uu.grade).trim() ? String(uu.grade).trim() : null,
      }
    })
    .filter(u => u.serialNumber)
  if (units.length === 0) return NextResponse.json({ error: 'At least one unit with a serial number is required' }, { status: 400 })

  // Snapshot whether each serial currently exists + its SKU (read-only lookup).
  const serialNumbers = Array.from(new Set(units.map(u => u.serialNumber)))
  const existing = await prisma.inventorySerial.findMany({
    where: { serialNumber: { in: serialNumbers } },
    select: { serialNumber: true, product: { select: { sku: true } } },
  })
  const bySerial = new Map(existing.map(s => [s.serialNumber.toUpperCase(), s.product?.sku ?? null]))

  const created = await prisma.processReturn.create({
    data: {
      trackingNumber,
      carrier,
      note,
      createdByLabel: user.name || user.email,
      units: {
        create: units.map(u => {
          const hit = bySerial.has(u.serialNumber.toUpperCase())
          return {
            serialNumber: u.serialNumber,
            grade: u.grade,
            serialExists: hit,
            sku: hit ? bySerial.get(u.serialNumber.toUpperCase()) ?? null : null,
          }
        }),
      },
    },
    include: { units: { orderBy: { createdAt: 'asc' } } },
  })

  return NextResponse.json({ data: created }, { status: 201 })
}
