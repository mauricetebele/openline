/**
 * GET /api/repair-orders/[id]/label/pdf?direction=outbound|inbound&dl=1
 * Streams the repair order's stored label(s) as a single PDF — merged when the
 * shipment has multiple pieces. Served as a direct URL so Print/Download work as
 * plain links (no fetch → no lost user-gesture → no popup/download blocking).
 * `dl=1` sends it as an attachment; otherwise inline (for printing).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { PDFDocument } from 'pdf-lib'

export const dynamic = 'force-dynamic'

function b64ToBytes(b64: string): Uint8Array {
  const buf = Buffer.from(b64, 'base64')
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.repairOrder.findUnique({
    where: { id: params.id },
    select: { orderNumber: true, outboundTracking: true, inboundTracking: true },
  })
  if (!order) return NextResponse.json({ error: 'Repair order not found' }, { status: 404 })

  const direction = req.nextUrl.searchParams.get('direction') === 'inbound' ? 'inbound' : 'outbound'
  const csv = direction === 'inbound' ? order.inboundTracking : order.outboundTracking
  const nums = (csv ?? '').split(',').map(t => t.trim()).filter(Boolean)
  if (nums.length === 0) return NextResponse.json({ error: 'No label on this shipment' }, { status: 404 })

  const rows = await prisma.returnLabel.findMany({
    where: { trackingNumber: { in: nums } },
    select: { trackingNumber: true, labelData: true },
  })
  const byTn = new Map(rows.map(r => [r.trackingNumber, r.labelData]))
  const datas = nums.map(tn => byTn.get(tn)).filter((d): d is string => !!d)
  if (datas.length === 0) return NextResponse.json({ error: 'No stored label data' }, { status: 404 })

  let pdfBytes: Uint8Array
  if (datas.length === 1) {
    pdfBytes = b64ToBytes(datas[0])
  } else {
    // Merge all pieces into one PDF (labels are already 4×6).
    const out = await PDFDocument.create()
    for (const d of datas) {
      try {
        const src = await PDFDocument.load(b64ToBytes(d))
        const pages = await out.copyPages(src, src.getPageIndices())
        pages.forEach(pg => out.addPage(pg))
      } catch { /* skip an unreadable piece */ }
    }
    pdfBytes = await out.save()
  }

  const dl = req.nextUrl.searchParams.get('dl') === '1'
  const filename = `RO-${String(order.orderNumber).padStart(4, '0')}-${direction}.pdf`
  return new NextResponse(new Uint8Array(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${dl ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
