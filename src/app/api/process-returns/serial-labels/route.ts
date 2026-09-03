/**
 * POST /api/process-returns/serial-labels
 * Body: { serialNumbers: string[] }
 *
 * Read-only. Resolves each serial number to its live inventory record and
 * returns the data needed to print a serial label (SKU, grade) plus whether the
 * unit is currently IN_STOCK — the caller only prints labels for in-stock units.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const raw: unknown[] = Array.isArray(body?.serialNumbers) ? body.serialNumbers : []
  const wanted = Array.from(new Set(raw.map(s => String(s ?? '').trim()).filter(Boolean)))
  if (wanted.length === 0) return NextResponse.json({ labels: [] })

  const serials = await prisma.inventorySerial.findMany({
    where: { serialNumber: { in: wanted, mode: 'insensitive' } },
    select: {
      serialNumber: true,
      status: true,
      product: { select: { sku: true } },
      grade: { select: { grade: true } },
    },
  })

  // Key by lowercase serial for case-insensitive matching back to the request.
  const bySn = new Map(serials.map(s => [s.serialNumber.toLowerCase(), s]))

  const labels = wanted.map(sn => {
    const hit = bySn.get(sn.toLowerCase())
    return {
      serialNumber: hit?.serialNumber ?? sn,
      sku: hit?.product?.sku ?? null,
      grade: hit?.grade?.grade ?? null,
      found: !!hit,
      inStock: hit?.status === 'IN_STOCK',
    }
  })

  return NextResponse.json({ labels })
}
