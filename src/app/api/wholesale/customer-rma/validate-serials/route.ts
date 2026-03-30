/**
 * POST /api/wholesale/customer-rma/validate-serials
 * Validate serial numbers were sold to a specific customer and are eligible for RMA.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

interface ValidResult {
  serialNumber: string
  valid: true
  inventorySerialId: string
  productId: string
  productSku: string
  productDescription: string
  gradeName: string | null
  salePrice: number | null
  salesOrderId: string
  salesOrderNumber: string
  soldAt: string | null
  daysSinceSold: number | null
}

interface InvalidResult {
  serialNumber: string
  valid: false
  reason: string
}

type ValidationResult = ValidResult | InvalidResult

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { customerId: string; serialNumbers: string[] }

  if (!body.customerId) {
    return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
  }
  if (!body.serialNumbers?.length) {
    return NextResponse.json({ error: 'serialNumbers is required' }, { status: 400 })
  }

  // Deduplicate & trim
  const serials = Array.from(new Set(body.serialNumbers.map(s => s.trim()).filter(Boolean)))

  const results: ValidationResult[] = []

  for (const sn of serials) {
    // 1. Find InventorySerial by serialNumber
    const inventorySerial = await prisma.inventorySerial.findFirst({
      where: { serialNumber: sn },
      include: {
        product: { select: { id: true, sku: true, description: true } },
        grade: { select: { id: true, grade: true } },
      },
    })

    if (!inventorySerial) {
      results.push({ serialNumber: sn, valid: false, reason: 'Serial number not found' })
      continue
    }

    // 2. Find SalesOrderSerialAssignment where serial was sold to this customer
    const assignment = await prisma.salesOrderSerialAssignment.findFirst({
      where: {
        serialId: inventorySerial.id,
        salesOrder: {
          customerId: body.customerId,
          fulfillmentStatus: 'SHIPPED',
        },
      },
      include: {
        salesOrder: {
          select: {
            id: true,
            orderNumber: true,
            shippedAt: true,
            items: {
              where: { productId: inventorySerial.productId },
              select: { unitPrice: true },
              take: 1,
            },
          },
        },
      },
    })

    if (!assignment) {
      results.push({
        serialNumber: sn,
        valid: false,
        reason: 'Serial was not sold to this customer',
      })
      continue
    }

    // 3. Check if already on an open RMA
    const existingRMA = await prisma.customerRMASerial.findFirst({
      where: {
        inventorySerialId: inventorySerial.id,
        rma: { status: { in: ['PENDING', 'RECEIVED', 'INSPECTED'] } },
      },
    })

    if (existingRMA) {
      results.push({
        serialNumber: sn,
        valid: false,
        reason: 'Serial is already on an open RMA',
      })
      continue
    }

    // Valid — build result
    const unitPrice = assignment.salesOrder.items[0]?.unitPrice
    const shippedAt = assignment.salesOrder.shippedAt
    const daysSinceSold = shippedAt
      ? Math.floor((Date.now() - new Date(shippedAt).getTime()) / (1000 * 60 * 60 * 24))
      : null

    results.push({
      serialNumber: sn,
      valid: true,
      inventorySerialId: inventorySerial.id,
      productId: inventorySerial.productId,
      productSku: inventorySerial.product.sku,
      productDescription: inventorySerial.product.description,
      gradeName: inventorySerial.grade?.grade ?? null,
      salePrice: unitPrice ? Number(unitPrice) : null,
      salesOrderId: assignment.salesOrder.id,
      salesOrderNumber: assignment.salesOrder.orderNumber,
      soldAt: shippedAt?.toISOString() ?? null,
      daysSinceSold,
    })
  }

  return NextResponse.json({ results })
}
