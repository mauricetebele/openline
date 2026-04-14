/**
 * POST /api/serials/validate-batch
 * Batch validation of serial numbers for a given SKU/grade.
 *
 * Body: {
 *   serials: string[]           // serial numbers to validate
 *   sku: string                 // expected product SKU
 *   gradeId?: string | null     // expected grade (optional)
 *   excludeSalesOrderId?: string // exclude this wholesale order from assignment checks
 * }
 *
 * Returns: {
 *   results: Record<string, {
 *     valid: boolean
 *     serialId?: string
 *     location?: string
 *     reason?: string
 *     detail?: string
 *   }>
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { serials, sku, gradeId: rawGradeId, excludeSalesOrderId } = body as {
    serials: string[]
    sku: string
    gradeId?: string | null
    excludeSalesOrderId?: string
  }

  if (!Array.isArray(serials) || serials.length === 0 || !sku) {
    return NextResponse.json({ error: 'serials array and sku are required' }, { status: 400 })
  }

  // Cap at 500 to prevent abuse
  if (serials.length > 500) {
    return NextResponse.json({ error: 'Too many serials (max 500)' }, { status: 400 })
  }

  let gradeId = rawGradeId?.trim() || null

  // Resolve product
  let expectedProduct = await prisma.product.findUnique({ where: { sku } })
  const msku = await prisma.productGradeMarketplaceSku.findFirst({
    where: { sellerSku: sku },
    include: { product: true },
  })
  if (!expectedProduct) {
    expectedProduct = msku?.product ?? null
  }
  if (!gradeId && msku?.gradeId) {
    gradeId = msku.gradeId
  }
  if (!expectedProduct) {
    const results: Record<string, { valid: boolean; reason: string; detail: string }> = {}
    for (const sn of serials) {
      results[sn.trim()] = { valid: false, reason: 'NOT_FOUND', detail: `No product found for SKU "${sku}"` }
    }
    return NextResponse.json({ results })
  }

  // Normalize serial numbers
  const snList = serials.map(s => s.trim()).filter(Boolean)

  // Fetch all serials in one query (case-insensitive match)
  const allSerials = await prisma.inventorySerial.findMany({
    where: {
      serialNumber: { in: snList, mode: 'insensitive' },
    },
    include: {
      product: true,
      location: { include: { warehouse: true } },
      orderAssignments: { include: { order: { select: { workflowStatus: true } } } },
      salesOrderAssignment: { include: { salesOrder: { select: { fulfillmentStatus: true, id: true } } } },
    },
  })

  // Build lookup by serial number (lowercased)
  const serialMap = new Map(allSerials.map(s => [s.serialNumber.toLowerCase(), s]))

  // Grade name cache
  const gradeNames = new Map<string, string>()
  if (gradeId) {
    const g = await prisma.grade.findUnique({ where: { id: gradeId }, select: { grade: true } })
    if (g) gradeNames.set(gradeId, g.grade)
  }

  const results: Record<string, {
    valid: boolean; serialId?: string; location?: string
    reason?: string; detail?: string
  }> = {}

  for (const sn of snList) {
    const serial = serialMap.get(sn.toLowerCase())

    if (!serial) {
      results[sn] = { valid: false, reason: 'NOT_FOUND', detail: `Serial "${sn}" not found in inventory` }
      continue
    }

    // Wrong product
    if (serial.productId !== expectedProduct.id) {
      results[sn] = {
        valid: false, reason: 'WRONG_SKU',
        detail: `Serial "${sn}" belongs to SKU "${serial.product.sku}", not "${sku}"`,
      }
      continue
    }

    // Grade checks
    if (gradeId && serial.gradeId !== gradeId) {
      if (!serial.gradeId) {
        results[sn] = { valid: false, reason: 'WRONG_GRADE', detail: `Serial "${sn}" has no grade, expected "${gradeNames.get(gradeId) ?? gradeId}"` }
      } else {
        if (!gradeNames.has(serial.gradeId)) {
          const g = await prisma.grade.findUnique({ where: { id: serial.gradeId }, select: { grade: true } })
          if (g) gradeNames.set(serial.gradeId, g.grade)
        }
        results[sn] = {
          valid: false, reason: 'WRONG_GRADE',
          detail: `Serial "${sn}" is grade "${gradeNames.get(serial.gradeId) ?? 'Unknown'}", expected "${gradeNames.get(gradeId) ?? gradeId}"`,
        }
      }
      continue
    }
    if (!gradeId && serial.gradeId) {
      if (!gradeNames.has(serial.gradeId)) {
        const g = await prisma.grade.findUnique({ where: { id: serial.gradeId }, select: { grade: true } })
        if (g) gradeNames.set(serial.gradeId, g.grade)
      }
      results[sn] = {
        valid: false, reason: 'WRONG_GRADE',
        detail: `Serial "${sn}" is grade "${gradeNames.get(serial.gradeId) ?? 'Unknown'}", expected ungraded`,
      }
      continue
    }

    // Already assigned to active Amazon order
    const activeAssignment = serial.orderAssignments.some(a =>
      !['SHIPPED', 'CANCELLED'].includes(a.order.workflowStatus)
    )
    if (activeAssignment) {
      results[sn] = { valid: false, reason: 'ALREADY_ASSIGNED', detail: `Serial "${sn}" is already assigned to another order` }
      continue
    }

    // Already assigned to active wholesale order
    if (
      serial.salesOrderAssignment &&
      !['SHIPPED', 'CANCELLED'].includes(serial.salesOrderAssignment.salesOrder.fulfillmentStatus) &&
      serial.salesOrderAssignment.salesOrder.id !== excludeSalesOrderId
    ) {
      results[sn] = { valid: false, reason: 'ALREADY_ASSIGNED', detail: `Serial "${sn}" is already assigned to a wholesale order` }
      continue
    }

    // Not in stock
    if (serial.status !== 'IN_STOCK') {
      results[sn] = { valid: false, reason: 'NOT_IN_STOCK', detail: `Serial "${sn}" is not in stock (status: ${serial.status})` }
      continue
    }

    // Valid
    results[sn] = {
      valid: true,
      serialId: serial.id,
      location: `${serial.location.warehouse.name} › ${serial.location.name}`,
    }
  }

  return NextResponse.json({ results })
}
