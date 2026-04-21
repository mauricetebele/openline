/**
 * GET  /api/return-label/[id]  — retrieve label image (base64) for download/print
 * POST /api/return-label/[id]  — void the label via UPS API
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { voidReturnLabel } from '@/lib/ups-tracking'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const label = await prisma.returnLabel.findUnique({
    where: { id: params.id },
    select: { labelData: true, trackingNumber: true, voided: true },
  })

  if (!label) return NextResponse.json({ error: 'Label not found' }, { status: 404 })

  return NextResponse.json({
    labelData:      label.labelData,
    labelFormat:    'pdf',
    trackingNumber: label.trackingNumber,
    voided:         label.voided,
  })
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const label = await prisma.returnLabel.findUnique({
    where: { id: params.id },
    select: { shipmentId: true, voided: true, upsCredentialId: true },
  })

  if (!label)         return NextResponse.json({ error: 'Label not found' }, { status: 404 })
  if (label.voided)   return NextResponse.json({ error: 'Label already voided' }, { status: 400 })

  try {
    await voidReturnLabel(label.shipmentId, label.upsCredentialId ?? undefined)
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Void failed' },
      { status: 500 },
    )
  }

  await prisma.returnLabel.update({
    where: { id: params.id },
    data:  { voided: true, voidedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
