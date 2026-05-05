import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { serialIds?: string[] }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const serialIds = body.serialIds ?? []
  if (serialIds.length === 0) {
    return NextResponse.json({ error: 'No serial IDs provided' }, { status: 400 })
  }

  // Load serials with PO chain + direct vendor for vendor + product info
  const serials = await prisma.inventorySerial.findMany({
    where: { id: { in: serialIds } },
    include: {
      product: { select: { id: true, sku: true } },
      vendor: { select: { id: true, name: true } },
      receiptLine: {
        include: {
          purchaseOrderLine: {
            include: {
              purchaseOrder: {
                include: { vendor: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  })

  if (serials.length === 0) {
    return NextResponse.json({ error: 'No matching serials found' }, { status: 400 })
  }

  // Check if any serial already exists on another vendor RMA
  const serialNumbers = serials.map(s => s.serialNumber)
  const existingVrmaSerials = await prisma.vendorRMASerial.findMany({
    where: { serialNumber: { in: serialNumbers }, scannedOutAt: null },
    include: { rmaItem: { include: { rma: { select: { rmaNumber: true } } } } },
  })
  if (existingVrmaSerials.length > 0) {
    const dupes = existingVrmaSerials.map(s => `${s.serialNumber} (${s.rmaItem.rma.rmaNumber})`)
    return NextResponse.json({
      error: `${existingVrmaSerials.length} serial(s) already on a Vendor RMA: ${dupes.join(', ')}`,
    }, { status: 409 })
  }

  // Validate all serials are IN_STOCK
  const notInStock = serials.filter(s => s.status !== 'IN_STOCK')
  if (notInStock.length > 0) {
    return NextResponse.json({
      error: `${notInStock.length} serial(s) are not IN_STOCK`,
      serials: notInStock.map(s => s.serialNumber),
    }, { status: 400 })
  }

  // Validate all serials have a vendor and it's the same vendor
  // Check PO chain first, then fall back to direct vendorId
  const vendorIds = new Set<string>()
  const noVendor: string[] = []
  for (const s of serials) {
    const vid = s.receiptLine?.purchaseOrderLine?.purchaseOrder?.vendor?.id ?? s.vendor?.id
    if (!vid) {
      noVendor.push(s.serialNumber)
    } else {
      vendorIds.add(vid)
    }
  }

  if (noVendor.length > 0) {
    return NextResponse.json({
      error: `${noVendor.length} serial(s) have no linked vendor`,
      serials: noVendor,
    }, { status: 400 })
  }

  if (vendorIds.size > 1) {
    return NextResponse.json({
      error: 'Selected serials span multiple vendors — select serials from a single vendor',
    }, { status: 400 })
  }

  const vendorId = Array.from(vendorIds)[0]

  // Group serials by productId
  const groups = new Map<string, typeof serials>()
  for (const s of serials) {
    const pid = s.product.id
    if (!groups.has(pid)) groups.set(pid, [])
    groups.get(pid)!.push(s)
  }

  // Auto-generate rmaNumber (same pattern as vendor-rma POST)
  const last = await prisma.vendorRMA.findFirst({ orderBy: { createdAt: 'desc' } })
  let nextNum = 1
  if (last) {
    const match = last.rmaNumber.match(/VRMA-(\d+)/)
    if (match) nextNum = parseInt(match[1], 10) + 1
  }
  const rmaNumber = `VRMA-${String(nextNum).padStart(4, '0')}`

  // Create RMA with items and serials in a single transaction
  const rma = await prisma.vendorRMA.create({
    data: {
      rmaNumber,
      vendorId,
      items: {
        create: Array.from(groups.entries()).map(([productId, productSerials]) => {
          // Use average live PO cost across all serials in this group
          const costs = productSerials
            .map(s => s.receiptLine?.purchaseOrderLine?.unitCost != null
              ? Number(s.receiptLine!.purchaseOrderLine!.unitCost)
              : (s.unitCost != null ? Number(s.unitCost) : null))
            .filter((c): c is number => c != null)
          const unitCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null
          return {
            productId,
            quantity: productSerials.length,
            unitCost,
            serials: {
              create: productSerials.map((s: { serialNumber: string }) => ({ serialNumber: s.serialNumber })),
            },
          }
        }),
      },
    },
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, sku: true, description: true } },
          serials: true,
        },
      },
    },
  })

  return NextResponse.json(rma, { status: 201 })
}
