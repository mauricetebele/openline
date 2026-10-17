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
    const serialSelect = {
      select: {
        receiptLine: {
          select: {
            purchaseOrderLineId: true,
            receipt: { select: { receivedAt: true } },
          },
        },
      },
    }
    // Customer returns are received back through two separate flows that each
    // link the returned unit to an InventorySerial:
    //   • MarketplaceRMASerial — MFN / Back Market merchant-fulfilled returns.
    //   • FbaReturnReceipt      — FBA returns sent back to us via removals.
    // Count both, attributed to this PO via the serial's receipt line.
    const [rmaRows, fbaRows] = await Promise.all([
      prisma.marketplaceRMASerial.findMany({
        where: { receivedAt: { not: null }, inventorySerial: { receiptLine: { purchaseOrderLine: { purchaseOrderId: id } } } },
        select: { receivedAt: true, inventorySerial: serialSelect },
      }),
      prisma.fbaReturnReceipt.findMany({
        where: { inventorySerial: { receiptLine: { purchaseOrderLine: { purchaseOrderId: id } } } },
        select: { receivedAt: true, inventorySerial: serialSelect },
      }),
    ])

    const byLine: Record<string, number> = {}
    const tally = (rows: { receivedAt: Date | null; inventorySerial: { receiptLine: { purchaseOrderLineId: string; receipt: { receivedAt: Date } | null } | null } | null }[]) => {
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
    }
    tally(rmaRows)
    tally(fbaRows)

    const totalReturns = Object.values(byLine).reduce((s, n) => s + n, 0)

    return NextResponse.json({ totalReturns, byLine })
  } catch (err) {
    console.error('[PO Returns]', err)
    return NextResponse.json({ error: 'Failed to load return counts' }, { status: 500 })
  }
}
