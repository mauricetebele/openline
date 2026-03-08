import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: {
      vendor: { select: { name: true } },
      lines: {
        include: {
          product: { select: { sku: true } },
          grade: { select: { grade: true } },
        },
      },
      receipts: {
        include: {
          lines: {
            include: {
              product: { select: { sku: true } },
              serials: {
                include: {
                  grade: { select: { grade: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Build a lookup: productId → unitCost from PO lines
  const costByProduct = new Map<string, number>()
  for (const line of po.lines) {
    costByProduct.set(line.productId, Number(line.unitCost))
  }

  const rows: string[] = ['SKU,GRADE,COST,PO #,VENDOR,SERIAL']

  for (const receipt of po.receipts) {
    for (const rl of receipt.lines) {
      const sku = rl.product.sku
      const cost = costByProduct.get(rl.productId) ?? 0

      if (rl.serials.length > 0) {
        for (const serial of rl.serials) {
          rows.push([
            csvEscape(sku),
            csvEscape(serial.grade?.grade ?? ''),
            cost.toFixed(2),
            String(po.poNumber),
            csvEscape(po.vendor.name),
            csvEscape(serial.serialNumber),
          ].join(','))
        }
      } else {
        // Non-serialized items: one row per qty received
        for (let i = 0; i < rl.qtyReceived; i++) {
          rows.push([
            csvEscape(sku),
            csvEscape(''),
            cost.toFixed(2),
            String(po.poNumber),
            csvEscape(po.vendor.name),
            '',
          ].join(','))
        }
      }
    }
  }

  // Also include PO lines that have no receipts yet (no serial column)
  if (po.receipts.length === 0) {
    for (const line of po.lines) {
      for (let i = 0; i < line.qty; i++) {
        rows.push([
          csvEscape(line.product.sku),
          csvEscape(line.grade?.grade ?? ''),
          Number(line.unitCost).toFixed(2),
          String(po.poNumber),
          csvEscape(po.vendor.name),
          '',
        ].join(','))
      }
    }
  }

  const csv = rows.join('\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="PO-${po.poNumber}.csv"`,
    },
  })
}

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}
