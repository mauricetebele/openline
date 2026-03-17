import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rma = await prisma.vendorRMA.findUnique({
    where: { id: params.id },
    include: {
      vendor: { select: { vendorNumber: true, name: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          product: { select: { sku: true, description: true } },
          serials: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  })

  if (!rma) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Collect all serial numbers to look up PO/receipt data
  const allSerials = rma.items.flatMap(item =>
    item.serials.map(s => s.serialNumber)
  )

  // Look up inventory serials with PO chain for date received and PO #
  const inventorySerials = allSerials.length > 0
    ? await prisma.inventorySerial.findMany({
        where: { serialNumber: { in: allSerials } },
        select: {
          serialNumber: true,
          receiptLine: {
            select: {
              receipt: { select: { receivedAt: true } },
              purchaseOrderLine: {
                select: {
                  unitCost: true,
                  purchaseOrder: { select: { poNumber: true } },
                },
              },
            },
          },
        },
      })
    : []

  const serialInfoMap = new Map(
    inventorySerials.map(s => [s.serialNumber, {
      dateReceived: s.receiptLine?.receipt?.receivedAt ?? null,
      poNumber: s.receiptLine?.purchaseOrderLine?.purchaseOrder?.poNumber ?? null,
    }])
  )

  // Build flat rows: one per serial
  const rows = rma.items.flatMap(item => {
    if (item.serials.length === 0) {
      // Non-serializable item — single row
      return [{
        rmaNumber: rma.rmaNumber,
        vendor: `V-${rma.vendor.vendorNumber} — ${rma.vendor.name}`,
        sku: item.product.sku,
        description: item.product.description,
        serialNumber: '',
        quantity: item.quantity,
        cost: item.unitCost != null ? Number(item.unitCost) : null,
        dateReceived: null as string | null,
        poNumber: null as number | null,
        note: item.notes ?? '',
      }]
    }
    return item.serials.map(s => {
      const info = serialInfoMap.get(s.serialNumber)
      return {
        rmaNumber: rma.rmaNumber,
        vendor: `V-${rma.vendor.vendorNumber} — ${rma.vendor.name}`,
        sku: item.product.sku,
        description: item.product.description,
        serialNumber: s.serialNumber,
        quantity: 1,
        cost: item.unitCost != null ? Number(item.unitCost) : null,
        dateReceived: info?.dateReceived ? new Date(info.dateReceived).toISOString() : null,
        poNumber: info?.poNumber ?? null,
        note: item.notes ?? '',
      }
    })
  })

  return NextResponse.json({ rmaNumber: rma.rmaNumber, rows })
}
