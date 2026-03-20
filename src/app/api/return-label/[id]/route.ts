/**
 * GET  /api/return-label/[id]  — retrieve label image (base64) for download/print
 * POST /api/return-label/[id]  — void the label via UPS API
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { voidReturnLabel } from '@/lib/ups-tracking'
import Jimp from 'jimp'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const label = await prisma.returnLabel.findUnique({
    where: { id: params.id },
    select: { labelData: true, labelFormat: true, trackingNumber: true, voided: true },
  })

  if (!label) return NextResponse.json({ error: 'Label not found' }, { status: 404 })

  const rotate = req.nextUrl.searchParams.get('rotate')
  let labelData = label.labelData

  // Server-side rotation using jimp (pure JS — no native deps)
  if (rotate === '90') {
    try {
      const inputBuf = Buffer.from(label.labelData, 'base64')
      const image = await Jimp.read(inputBuf)
      image.rotate(-90) // -90 = 90° clockwise, auto-resize canvas
      const rotatedBuf = await image.getBufferAsync(Jimp.MIME_PNG)
      labelData = rotatedBuf.toString('base64')
    } catch (err) {
      console.error('[GET /api/return-label] rotation failed:', err)
      // Fall back to unrotated
    }
  }

  return NextResponse.json({
    labelData,
    labelFormat:    rotate === '90' ? 'PNG' : label.labelFormat,
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
    select: { shipmentId: true, voided: true },
  })

  if (!label)         return NextResponse.json({ error: 'Label not found' }, { status: 404 })
  if (label.voided)   return NextResponse.json({ error: 'Label already voided' }, { status: 400 })

  try {
    await voidReturnLabel(label.shipmentId)
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
