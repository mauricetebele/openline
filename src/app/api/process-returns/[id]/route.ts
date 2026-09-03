/**
 * GET   /api/process-returns/[id]  — one staged return
 * PATCH /api/process-returns/[id]  — administrator: set note-to-processor + flag
 *
 * Staging only — never affects inventory.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ret = await prisma.processReturn.findUnique({
    where: { id: params.id },
    include: { units: { orderBy: { createdAt: 'asc' } } },
  })
  if (!ret) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: ret })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  // ── Processor edit: resume a draft, update its fields/units, optionally finalize ──
  const isProcessorEdit = ['trackingNumber', 'carrier', 'note', 'units', 'completed'].some(k => k in body)
  if (isProcessorEdit) {
    const trackingNumber = String(body?.trackingNumber ?? '').trim()
    const carrier = String(body?.carrier ?? '').trim()
    const note = typeof body?.note === 'string' ? body.note.trim() || null : null
    const completed = body?.completed === true
    const rawUnits: unknown[] = Array.isArray(body?.units) ? body.units : []
    const units = rawUnits
      .map(u => {
        const uu = u as { serialNumber?: unknown; grade?: unknown }
        return {
          serialNumber: String(uu.serialNumber ?? '').trim(),
          grade: uu.grade != null && String(uu.grade).trim() ? String(uu.grade).trim() : null,
        }
      })
      .filter(u => u.serialNumber)

    // Finalizing requires the full record; a still-unfinished draft can be saved as-is.
    if (completed) {
      if (!trackingNumber) return NextResponse.json({ error: 'Tracking number is required' }, { status: 400 })
      if (!carrier) return NextResponse.json({ error: 'Carrier is required' }, { status: 400 })
      if (units.length === 0) return NextResponse.json({ error: 'At least one unit with a serial number is required' }, { status: 400 })
    }

    // Snapshot whether each serial currently exists + its SKU (read-only lookup).
    const serialNumbers = Array.from(new Set(units.map(u => u.serialNumber)))
    const existing = serialNumbers.length
      ? await prisma.inventorySerial.findMany({
          where: { serialNumber: { in: serialNumbers } },
          select: { serialNumber: true, product: { select: { sku: true } } },
        })
      : []
    const bySerial = new Map(existing.map(s => [s.serialNumber.toUpperCase(), s.product?.sku ?? null]))

    const updated = await prisma.$transaction(async tx => {
      await tx.processReturnUnit.deleteMany({ where: { returnId: params.id } })
      return tx.processReturn.update({
        where: { id: params.id },
        data: {
          trackingNumber,
          carrier,
          note,
          completed,
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
    })
    return NextResponse.json({ data: updated })
  }

  // ── Administrator: set note-to-processor + flag ──
  const data: {
    adminNote?: string | null
    flagged?: boolean
    adminNoteByLabel?: string | null
    adminNoteAt?: Date
  } = {}

  if ('adminNote' in body) {
    data.adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim() || null : null
    data.adminNoteByLabel = user.name || user.email
    data.adminNoteAt = new Date()
  }
  if ('flagged' in body) data.flagged = !!body.flagged

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const updated = await prisma.processReturn.update({
    where: { id: params.id },
    data,
    include: { units: { orderBy: { createdAt: 'asc' } } },
  })
  return NextResponse.json({ data: updated })
}
