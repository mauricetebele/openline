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
        receivedAt: true,
        inventorySerial: {
          select: {
            receiptLine: {
              select: {
                purchaseOrderLineId: true,
                receipt: { select: { receivedAt: true } },
              },
            },
          },
        },
      },
    })

    const byLine: Record<string, number> = {}
    for (const r of rows) {
      const line = r.inventorySerial?.receiptLine
      const lineId = line?.purchaseOrderLineId
      if (!lineId) continue
      // A serial can be received on this PO, returned to the vendor, then bought
      // and re-received again on a LATER PO. Its receiptLine now points to the
      // newer PO, so an OLD customer return (from the previous cycle) would be
      // mis-attributed here. Only count returns that happened AFTER the unit was
      // received on THIS PO — otherwise a re-purchased serial should reset to 0.
      const poReceivedAt = line?.receipt?.receivedAt
      if (poReceivedAt && r.receivedAt && r.receivedAt < poReceivedAt) continue
      byLine[lineId] = (byLine[lineId] ?? 0) + 1
    }

    const totalReturns = Object.values(byLine).reduce((s, n) => s + n, 0)

    return NextResponse.json({ totalReturns, byLine })
  } catch (err) {
    console.error('[PO Returns]', err)
    return NextResponse.json({ error: 'Failed to load return counts' }, { status: 500 })
  }
}
