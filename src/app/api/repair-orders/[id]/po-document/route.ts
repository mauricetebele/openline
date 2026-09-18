/**
 * GET /api/repair-orders/[id]/po-document
 * Repair PO as an .xlsx: vendor, creation date, serials, repair type, repair cost
 * requested, and a total. Opens directly in Excel.
 */
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.repairOrder.findUnique({
    where: { id: params.id },
    include: {
      vendor: true,
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          repairType: { select: { name: true } },
          inventorySerial: { select: { serialNumber: true, product: { select: { sku: true, description: true } } } },
        },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'Repair order not found' }, { status: 404 })

  const ro = `RO-${String(order.orderNumber).padStart(4, '0')}`
  const dateStr = order.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const total = order.items.reduce((s, it) => s + (it.repairCost != null ? Number(it.repairCost) : 0), 0)

  // Each tracking number on its own row, carrier beside it.
  const trackRows = (label: string, carrier: string | null, csv: string | null): (string | number)[][] => {
    const tns = (csv ?? '').split(',').map(t => t.trim()).filter(Boolean)
    if (tns.length === 0) return []
    return [[`${label} Tracking #`, 'Carrier'], ...tns.map(tn => [tn, carrier ?? ''])]
  }

  const aoa: (string | number)[][] = [
    ['Repair Purchase Order'],
    ['Vendor', order.vendor.companyName],
    ...(order.vendor.email ? [['Vendor Email', order.vendor.email]] : []),
    ...(order.vendor.phone ? [['Vendor Phone', order.vendor.phone]] : []),
    ['Repair Order #', ro],
    ['Date', dateStr],
    ['Units', order.items.length],
    ...(order.outboundTracking ? [[] as (string | number)[], ...trackRows('Outbound', order.outboundCarrier, order.outboundTracking)] : []),
    ...(order.inboundTracking ? [[] as (string | number)[], ...trackRows('Inbound', order.inboundCarrier, order.inboundTracking)] : []),
    [],
    ['Serial / IMEI', 'SKU', 'Model', 'Repair Type', 'Repair Cost'],
    ...order.items.map(it => [
      it.inventorySerial.serialNumber,
      it.inventorySerial.product?.sku ?? '',
      it.inventorySerial.product?.description ?? '',
      it.repairType?.name ?? '',
      it.repairCost != null ? Number(it.repairCost) : '',
    ]),
    [],
    ['', '', '', 'Total', total],
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 40 }, { wch: 18 }, { wch: 14 }]
  // Currency format for the Repair Cost column (E) across item + total rows.
  const headerRow = aoa.findIndex(r => r[0] === 'Serial / IMEI')
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 4 })]
    if (cell && typeof cell.v === 'number') { cell.t = 'n'; cell.z = '$#,##0.00' }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Repair PO')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Repair-PO-${ro}.xlsx"`,
    },
  })
}
