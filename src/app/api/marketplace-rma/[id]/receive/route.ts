import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { serialUpdates, nonSerialItems } = body as {
    serialUpdates: Array<{
      rmaSerialId: string
      inventorySerialId?: string
      locationId: string
      gradeId?: string | null
      note?: string
    }>
    nonSerialItems?: Array<{
      rmaItemId: string
      productId: string
      locationId: string
      gradeId?: string | null
      quantityReturned: number
    }>
  }

  // Load the RMA
  const rma = await prisma.marketplaceRMA.findUnique({
    where: { id: params.id },
    include: {
      items: { include: { serials: true } },
      order: { select: { id: true } },
    },
  })

  if (!rma) return NextResponse.json({ error: 'RMA not found' }, { status: 404 })
  if (rma.status !== 'OPEN') {
    return NextResponse.json({ error: 'RMA is already received' }, { status: 400 })
  }

  // Validate all serial updates have locations
  if (serialUpdates?.length) {
    for (const su of serialUpdates) {
      if (!su.locationId) {
        return NextResponse.json({ error: 'All serials must have a location assigned' }, { status: 400 })
      }
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Process serial returns
      if (serialUpdates?.length) {
        for (const su of serialUpdates) {
          const gradeId = su.gradeId || null

          // Update MarketplaceRMASerial
          await tx.marketplaceRMASerial.update({
            where: { id: su.rmaSerialId },
            data: {
              receivedAt: new Date(),
              locationId: su.locationId,
              gradeId,
              note: su.note?.trim() || null,
            },
          })

          // Update InventorySerial → IN_STOCK at the new location
          if (su.inventorySerialId) {
            // Clean up stale serial assignment from the original shipped order
            await tx.orderSerialAssignment.deleteMany({
              where: { inventorySerialId: su.inventorySerialId },
            })

            const serial = await tx.inventorySerial.update({
              where: { id: su.inventorySerialId },
              data: {
                status: 'IN_STOCK',
                locationId: su.locationId,
                gradeId,
                note: su.note?.trim() || null,
              },
            })

            // Create SerialHistory
            await tx.serialHistory.create({
              data: {
                inventorySerialId: su.inventorySerialId,
                eventType: 'MP_RMA_RETURN',
                locationId: su.locationId,
                orderId: rma.orderId,
              },
            })

            // Increment inventory qty for the returned serial
            if (gradeId) {
              await tx.inventoryItem.upsert({
                where: {
                  productId_locationId_gradeId: {
                    productId: serial.productId,
                    locationId: su.locationId,
                    gradeId,
                  },
                },
                create: {
                  productId: serial.productId,
                  locationId: su.locationId,
                  gradeId,
                  qty: 1,
                },
                update: { qty: { increment: 1 } },
              })
            } else {
              const existing = await tx.inventoryItem.findFirst({
                where: { productId: serial.productId, locationId: su.locationId, gradeId: null },
              })
              if (existing) {
                await tx.inventoryItem.update({
                  where: { id: existing.id },
                  data: { qty: { increment: 1 } },
                })
              } else {
                await tx.inventoryItem.create({
                  data: {
                    productId: serial.productId,
                    locationId: su.locationId,
                    gradeId: null,
                    qty: 1,
                  },
                })
              }
            }
          }
        }
      }

      // 2. Process non-serial item returns (upsert inventory qty)
      if (nonSerialItems?.length) {
        for (const item of nonSerialItems) {
          const gradeId = item.gradeId || null
          if (gradeId) {
            await tx.inventoryItem.upsert({
              where: {
                productId_locationId_gradeId: {
                  productId: item.productId,
                  locationId: item.locationId,
                  gradeId,
                },
              },
              create: {
                productId: item.productId,
                locationId: item.locationId,
                gradeId,
                qty: item.quantityReturned,
              },
              update: { qty: { increment: item.quantityReturned } },
            })
          } else {
            const existing = await tx.inventoryItem.findFirst({
              where: { productId: item.productId, locationId: item.locationId, gradeId: null },
            })
            if (existing) {
              await tx.inventoryItem.update({
                where: { id: existing.id },
                data: { qty: { increment: item.quantityReturned } },
              })
            } else {
              await tx.inventoryItem.create({
                data: {
                  productId: item.productId,
                  locationId: item.locationId,
                  gradeId: null,
                  qty: item.quantityReturned,
                },
              })
            }
          }
        }
      }

      // 3. Update RMA status → RECEIVED
      return tx.marketplaceRMA.update({
        where: { id: params.id },
        data: { status: 'RECEIVED' },
        include: {
          order: {
            select: { id: true, olmNumber: true, amazonOrderId: true },
          },
          items: {
            include: { serials: true },
          },
        },
      })
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[MP-RMA Receive] Transaction error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
