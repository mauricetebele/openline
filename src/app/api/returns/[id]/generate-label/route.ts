/**
 * GET  /api/returns/[id]/generate-label  — prefill buyer address from linked order
 * POST /api/returns/[id]/generate-label  — generate UPS return label
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { generateReturnLabel, UPS_SERVICES, ReturnLabelRequest } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ret = await prisma.mFNReturn.findUnique({ where: { id: params.id } })
  if (!ret) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Try to find buyer address from the Order table
  let buyerAddress: {
    name: string | null
    address1: string | null
    address2: string | null
    city: string | null
    state: string | null
    postal: string | null
    country: string | null
  } = { name: null, address1: null, address2: null, city: null, state: null, postal: null, country: null }

  if (ret.orderId) {
    const order = await prisma.order.findFirst({
      where: { amazonOrderId: ret.orderId },
      select: {
        shipToName: true,
        shipToAddress1: true,
        shipToAddress2: true,
        shipToCity: true,
        shipToState: true,
        shipToPostal: true,
        shipToCountry: true,
      },
    })
    if (order) {
      buyerAddress = {
        name:     order.shipToName,
        address1: order.shipToAddress1,
        address2: order.shipToAddress2,
        city:     order.shipToCity,
        state:    order.shipToState,
        postal:   order.shipToPostal,
        country:  order.shipToCountry,
      }
    }
  }

  return NextResponse.json({
    orderId:    ret.orderId,
    rmaId:      ret.rmaId,
    buyerAddress,
    services:   UPS_SERVICES,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ret = await prisma.mFNReturn.findUnique({ where: { id: params.id } })
  if (!ret) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json() as ReturnLabelRequest

  if (!body.shipFromName?.trim() || !body.shipFromAddress1?.trim() || !body.shipFromCity?.trim() ||
      !body.shipFromState?.trim() || !body.shipFromPostal?.trim()) {
    return NextResponse.json({ error: 'Ship-from address fields are required' }, { status: 400 })
  }
  if (!body.serviceCode) {
    return NextResponse.json({ error: 'Service code is required' }, { status: 400 })
  }
  if (!body.weightValue || body.weightValue <= 0) {
    return NextResponse.json({ error: 'Weight is required' }, { status: 400 })
  }

  try {
    const result = await generateReturnLabel(body)
    return NextResponse.json(result)
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Label generation failed' },
      { status: 500 },
    )
  }
}
