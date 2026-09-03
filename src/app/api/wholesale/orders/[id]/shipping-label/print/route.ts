/**
 * GET /api/wholesale/orders/[id]/shipping-label/print
 *
 * Merges every piece of the order's most recent (non-voided) label set into a
 * single multi-page PDF so all boxes print from one tab (avoids per-tab pop-up
 * blocking). Returns { labelData: base64Pdf, count }.
 */
import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const labels = await prisma.returnLabel.findMany({
    where: { salesOrderId: params.id, voided: false },
    orderBy: { createdAt: 'desc' },
    select: { id: true, shipmentId: true, labelData: true, createdAt: true },
  })
  if (labels.length === 0) return NextResponse.json({ error: 'No shipping label found for this order' }, { status: 404 })

  // Most recent shipment set (multi-box pieces share a shipmentId), in piece order.
  const latestSet = labels[0].shipmentId
  const set = (latestSet ? labels.filter(l => l.shipmentId === latestSet) : [labels[0]])
    .slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  if (set.length === 1) {
    return NextResponse.json({ labelData: set[0].labelData, count: 1 })
  }

  try {
    const merged = await PDFDocument.create()
    for (const l of set) {
      const src = await PDFDocument.load(Buffer.from(l.labelData, 'base64'))
      const pages = await merged.copyPages(src, src.getPageIndices())
      pages.forEach(p => merged.addPage(p))
    }
    const bytes = await merged.save()
    return NextResponse.json({ labelData: Buffer.from(bytes).toString('base64'), count: set.length })
  } catch (e) {
    console.error('[WholesaleLabel] merge failed:', e)
    return NextResponse.json({ error: 'Could not merge labels for printing' }, { status: 500 })
  }
}
