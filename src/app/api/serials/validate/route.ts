/**
 * GET /api/serials/validate?sn=SERIAL&sku=SKU
 * Real-time validation of a serial number for a given SKU.
 *
 * Returns:
 *   { valid: true,  serialId, location, productDescription }  — serial is good to use
 *   { valid: false, reason, detail }                          — explains why it's invalid
 *
 * Reasons: NOT_FOUND | WRONG_SKU | NOT_IN_STOCK | ALREADY_ASSIGNED
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sn  = req.nextUrl.searchParams.get('sn')?.trim()
  const sku = req.nextUrl.searchParams.get('sku')?.trim()

  if (!sn || !sku) {
    return NextResponse.json({ error: 'sn and sku query params are required' }, { status: 400 })
  }

  // Find the product for the expected SKU
  const expectedProduct = await prisma.product.findUnique({ where: { sku } })
  if (!expectedProduct) {
    return NextResponse.json({ valid: false, reason: 'NOT_FOUND', detail: `No product found for SKU "${sku}"` })
  }

  // Find the serial number across ALL products (so we can give a useful error for wrong SKU)
  const serial = await prisma.inventorySerial.findFirst({
    where: { serialNumber: sn },
    include: {
      product:        true,
      location:       { include: { warehouse: true } },
      orderAssignment: true,
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

  // Already assigned to an order
  if (serial.orderAssignment) {
    return NextResponse.json({
      valid:  false,
      reason: 'ALREADY_ASSIGNED',
      detail: `Serial "${sn}" is already assigned to another order`,
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
