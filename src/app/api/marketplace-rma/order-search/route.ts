import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ data: [] })

  // Extract numeric portion from "OLM-104", "olm 104", "OLM104", or plain "104"
  const olmMatch = q.match(/^(?:olm[- ]?)?(\d+)$/i)

  let matchingIds: string[] | null = null

  if (olmMatch) {
    // Prefix filter: cast olmNumber to text and use LIKE 'prefix%'
    const prefix = olmMatch[1]
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM orders WHERE "workflowStatus" = 'SHIPPED' AND CAST("olmNumber" AS TEXT) LIKE ${prefix + '%'} LIMIT 20`
    )
    matchingIds = rows.map(r => r.id)
    if (matchingIds.length === 0) return NextResponse.json({ data: [] })
  }

  const where: Record<string, unknown> = {
    workflowStatus: 'SHIPPED',
  }

  if (matchingIds) {
    where.id = { in: matchingIds }
  } else {
    where.OR = [
      { shipToName: { contains: q, mode: 'insensitive' } },
      { amazonOrderId: { contains: q, mode: 'insensitive' } },
    ]
  }

  const orders = await prisma.order.findMany({
    where,
    take: 20,
    orderBy: { purchaseDate: 'desc' },
    select: {
      id: true,
      olmNumber: true,
      amazonOrderId: true,
      orderSource: true,
      shipToName: true,
      shipToCity: true,
      shipToState: true,
      purchaseDate: true,
      items: {
        select: {
          id: true,
          orderItemId: true,
          asin: true,
          sellerSku: true,
          title: true,
          quantityOrdered: true,
          quantityShipped: true,
          serialAssignments: {
            select: {
              inventorySerial: {
                select: {
                  id: true,
                  serialNumber: true,
                  productId: true,
                  product: {
                    select: { id: true, sku: true, description: true, isSerializable: true },
                  },
                  grade: { select: { id: true, grade: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  return NextResponse.json({ data: orders })
}
