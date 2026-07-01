import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orderId = req.nextUrl.searchParams.get('orderId')?.trim()
  if (!orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 })

  const invoices = await prisma.legacyInvoice.findMany({
    where: { orderId },
    select: { id: true, orderId: true, orderDate: true, customerName: true, items: true },
  })

  return NextResponse.json({ data: invoices })
}
