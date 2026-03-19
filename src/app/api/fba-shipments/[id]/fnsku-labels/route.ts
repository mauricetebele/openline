/**
 * POST /api/fba-shipments/[id]/fnsku-labels
 *
 * Generates FNSKU item labels via Amazon SP-API (createMarketplaceItemLabels).
 * Returns a temporary S3 download URL to a PDF with barcoded labels that include
 * the product title and Amazon condition — the official Amazon label format.
 *
 * Body (optional):
 *   { labelType?: 'THERMAL_PRINTING' | 'STANDARD_FORMAT', pageType?: string }
 *   Defaults to THERMAL_PRINTING sized for Dymo 30334 (57mm x 32mm).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { createMarketplaceItemLabels } from '@/lib/amazon/fba-inbound'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: {
      items: { select: { sellerSku: true, quantity: true } },
      account: { select: { id: true, marketplaceId: true } },
    },
  })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (shipment.items.length === 0) {
    return NextResponse.json({ error: 'Shipment has no items' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({})) as {
    labelType?: 'THERMAL_PRINTING' | 'STANDARD_FORMAT'
    pageType?: string
  }

  const labelType = body.labelType ?? 'THERMAL_PRINTING'

  try {
    const downloadUrl = await createMarketplaceItemLabels(shipment.accountId, {
      marketplaceId: shipment.account.marketplaceId,
      mskuQuantities: shipment.items.map(item => ({
        msku: item.sellerSku,
        quantity: item.quantity,
      })),
      labelType,
      // Dymo 30334: 2.25" x 1.25" → 57.15mm x 31.75mm
      ...(labelType === 'THERMAL_PRINTING' ? { width: 57, height: 32 } : {}),
      ...(labelType === 'STANDARD_FORMAT' && body.pageType ? { pageType: body.pageType } : {}),
    })

    return NextResponse.json({ downloadUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/fba-shipments/[id]/fnsku-labels]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
