import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const rows = await prisma.marketplaceRMASerial.findMany({
      where: {
        receivedAt: { not: null },
        inventorySerial: {
          receiptLine: {
            purchaseOrderLine: { purchaseOrderId: id },
          },
        },
      },
      select: {
        inventorySerial: {
          select: {
            receiptLine: {
              select: { purchaseOrderLineId: true },
            },
          },
        },
      },
    })

    const byLine: Record<string, number> = {}
    for (const r of rows) {
      const lineId = r.inventorySerial?.receiptLine?.purchaseOrderLineId
      if (lineId) byLine[lineId] = (byLine[lineId] ?? 0) + 1
    }

    const totalReturns = Object.values(byLine).reduce((s, n) => s + n, 0)

    return NextResponse.json({ totalReturns, byLine })
  } catch (err) {
    console.error('[PO Returns]', err)
    return NextResponse.json({ error: 'Failed to load return counts' }, { status: 500 })
  }
}
