import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user || user.role !== 'VENDOR' || !user.vendorId || !user.canViewPurchaseOrders)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orders = await prisma.purchaseOrder.findMany({
    where: { vendorId: user.vendorId },
    include: {
      vendor: { select: { id: true, vendorNumber: true, name: true } },
      lines: {
        include: {
          product: { select: { id: true, description: true, sku: true } },
          grade: { select: { id: true, grade: true } },
          receiptLines: { select: { qtyReceived: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { poNumber: 'desc' },
  })

  return NextResponse.json({ data: orders })
}
