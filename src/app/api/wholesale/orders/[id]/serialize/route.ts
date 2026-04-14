/**
 * POST /api/wholesale/orders/[id]/serialize
 * Body: { serials: [{ serialNumber: string; salesOrderItemId: string }] }
 *   OR  { serials: [{ serialId: string; salesOrderItemId: string }] }  (legacy)
 *
 * Creates SalesOrderSerialAssignment records for the order.
 * Serials stay IN_STOCK — inventory is only decremented on ship.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    serials: { serialId?: string; serialNumber?: string; salesOrderItemId: string }[]
  }

  const { serials } = body
  if (!serials?.length) {
    return NextResponse.json({ error: 'serials array is required' }, { status: 400 })
  }

  const so = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: { serialAssignments: true },
  })
  if (!so) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (so.fulfillmentStatus !== 'PROCESSING') {
    return NextResponse.json(
      { error: `Order is ${so.fulfillmentStatus} — must be PROCESSING to serialize` },
      { status: 409 },
    )
  }

  try {
    // Resolve serial IDs — accept either serialNumber or serialId
    const usesNumbers = serials.some(s => s.serialNumber)

    let resolvedSerials: { serialId: string; salesOrderItemId: string }[]

    if (usesNumbers) {
      // Resolve IDs from serial numbers server-side (avoids CUID pattern issues)
      const snList = serials.map(s => (s.serialNumber ?? '').trim()).filter(Boolean)
      const found = await prisma.inventorySerial.findMany({
        where: { serialNumber: { in: snList } },
        select: { id: true, serialNumber: true, status: true },
      })
      const snToSerial = new Map(found.map(s => [s.serialNumber, s]))

      // Check all were found
      const notFound = snList.filter(sn => !snToSerial.has(sn))
      if (notFound.length > 0) {
        return NextResponse.json({
          error: `Serial(s) not found: ${notFound.slice(0, 5).join(', ')}${notFound.length > 5 ? ` (+${notFound.length - 5} more)` : ''}`,
        }, { status: 400 })
      }

      // Check all IN_STOCK
      const notInStock = found.filter(s => s.status !== 'IN_STOCK')
      if (notInStock.length > 0) {
        return NextResponse.json({
          error: `Serial${notInStock.length > 1 ? 's' : ''} not IN_STOCK: ${notInStock.slice(0, 5).map(s => s.serialNumber).join(', ')}`,
        }, { status: 409 })
      }

      // Build resolved list
      resolvedSerials = serials.map(s => {
        const sn = (s.serialNumber ?? '').trim()
        const inv = snToSerial.get(sn)!
        return { serialId: inv.id, salesOrderItemId: s.salesOrderItemId }
      })
    } else {
      // Legacy path: serialId already provided
      const serialIds = serials.map(s => s.serialId!).filter(Boolean)
      const found = await prisma.inventorySerial.findMany({
        where: { id: { in: serialIds } },
        select: { id: true, status: true, serialNumber: true },
      })
      if (found.length !== serialIds.length) {
        return NextResponse.json({ error: 'One or more serial IDs not found' }, { status: 400 })
      }
      const notInStock = found.filter(s => s.status !== 'IN_STOCK')
      if (notInStock.length > 0) {
        return NextResponse.json({
          error: `Serial${notInStock.length > 1 ? 's' : ''} not IN_STOCK: ${notInStock.map(s => s.serialNumber).join(', ')}`,
        }, { status: 409 })
      }
      resolvedSerials = serials.map(s => ({ serialId: s.serialId!, salesOrderItemId: s.salesOrderItemId }))
    }

    // Remove any existing assignments for this order first (re-serialize scenario)
    await prisma.salesOrderSerialAssignment.deleteMany({
      where: { salesOrderId: params.id },
    })

    // Create all assignment records in one batch (serials stay IN_STOCK)
    await prisma.salesOrderSerialAssignment.createMany({
      data: resolvedSerials.map(s => ({
        salesOrderId:     params.id,
        salesOrderItemId: s.salesOrderItemId,
        serialId:         s.serialId,
      })),
    })

    return NextResponse.json({ ok: true, assigned: resolvedSerials.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[serialize] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
