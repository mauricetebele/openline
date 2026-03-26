/**
 * GET /api/serials/validate?sn=SERIAL&sku=SKU
 * Real-time validation of a serial number for a given SKU.
 *
 * Returns:
 *   { valid: true,  serialId, location, productDescription }  — serial is good to use
 *   { valid: false, reason, detail }                          — explains why it's invalid
 *
 * Reasons: NOT_FOUND | WRONG_SKU | WRONG_GRADE | NOT_IN_STOCK | ALREADY_ASSIGNED
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sn      = req.nextUrl.searchParams.get('sn')?.trim()
  const sku     = req.nextUrl.searchParams.get('sku')?.trim()
  let   gradeId = req.nextUrl.searchParams.get('gradeId')?.trim() || null
  const excludeSalesOrderId = req.nextUrl.searchParams.get('excludeSalesOrderId')?.trim() || null

  if (!sn || !sku) {
    return NextResponse.json({ error: 'sn and sku query params are required' }, { status: 400 })
  }

  // Find the product for the expected SKU (direct match or marketplace SKU mapping)
  let expectedProduct = await prisma.product.findUnique({ where: { sku } })
  const msku = await prisma.productGradeMarketplaceSku.findFirst({
    where: { sellerSku: sku },
    include: { product: true },
  })
  if (!expectedProduct) {
    expectedProduct = msku?.product ?? null
  }
  // Derive grade from marketplace SKU mapping if not explicitly provided
  if (!gradeId && msku?.gradeId) {
    gradeId = msku.gradeId
  }
  if (!expectedProduct) {
    return NextResponse.json({ valid: false, reason: 'NOT_FOUND', detail: `No product found for SKU "${sku}"` })
  }

  // Find the serial number across ALL products (so we can give a useful error for wrong SKU)
  const serial = await prisma.inventorySerial.findFirst({
    where: { serialNumber: { equals: sn, mode: 'insensitive' } },
    include: {
      product:        true,
      location:       { include: { warehouse: true } },
      orderAssignment: { include: { order: { select: { workflowStatus: true } } } },
      salesOrderAssignment: { include: { salesOrder: { select: { fulfillmentStatus: true } } } },
    },
  })

  if (!serial) {
    return NextResponse.json({ valid: false, reason: 'NOT_FOUND', detail: `Serial number "${sn}" not found in inventory` })
  }

  // Wrong SKU
  if (serial.productId !== expectedProduct.id) {
    return NextResponse.json({
      valid:  false,
      reason: 'WRONG_SKU',
      detail: `Serial "${sn}" belongs to SKU "${serial.product.sku}" (${serial.product.description}), not "${sku}"`,
    })
  }

  // Wrong grade
  if (gradeId && serial.gradeId !== gradeId) {
    const gradeName = serial.gradeId
      ? (await prisma.grade.findUnique({ where: { id: serial.gradeId }, select: { grade: true } }))?.grade ?? 'Unknown'
      : 'No grade'
    const expectedGrade = (await prisma.grade.findUnique({ where: { id: gradeId }, select: { grade: true } }))?.grade ?? gradeId
    return NextResponse.json({
      valid:  false,
      reason: 'WRONG_GRADE',
      detail: `Serial "${sn}" is grade "${gradeName}", expected "${expectedGrade}"`,
    })
  }
  // Ungraded item demands ungraded serial
  if (!gradeId && serial.gradeId) {
    const serialGrade = (await prisma.grade.findUnique({ where: { id: serial.gradeId }, select: { grade: true } }))?.grade ?? 'Unknown'
    return NextResponse.json({
      valid:  false,
      reason: 'WRONG_GRADE',
      detail: `Serial "${sn}" is grade "${serialGrade}", expected an ungraded unit`,
    })
  }

  // Already assigned to an active (non-terminal) Amazon order
  const activeAssignment = serial.orderAssignment &&
    !['SHIPPED', 'CANCELLED'].includes(serial.orderAssignment.order.workflowStatus)
  if (activeAssignment) {
    return NextResponse.json({
      valid:  false,
      reason: 'ALREADY_ASSIGNED',
      detail: `Serial "${sn}" is already assigned to another order`,
    })
  }

  // Already assigned to an active wholesale order (skip if assigned to the excluded order)
  const activeWholesaleAssignment = serial.salesOrderAssignment &&
    !['SHIPPED', 'CANCELLED'].includes(serial.salesOrderAssignment.salesOrder.fulfillmentStatus) &&
    serial.salesOrderAssignment.salesOrderId !== excludeSalesOrderId
  if (activeWholesaleAssignment) {
    return NextResponse.json({
      valid:  false,
      reason: 'ALREADY_ASSIGNED',
      detail: `Serial "${sn}" is already assigned to a wholesale order`,
    })
  }

  // Not in stock
  if (serial.status !== 'IN_STOCK') {
    return NextResponse.json({
      valid:  false,
      reason: 'NOT_IN_STOCK',
      detail: `Serial "${sn}" is not in stock (status: ${serial.status})`,
    })
  }

  // All checks passed
  return NextResponse.json({
    valid:              true,
    serialId:           serial.id,
    location:           `${serial.location.warehouse.name} › ${serial.location.name}`,
    productDescription: serial.product.description,
  })
}
