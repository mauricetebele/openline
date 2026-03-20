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

  // Server-side rotation via manual pixel manipulation (90° CW)
  if (rotate === '90') {
    try {
      const inputBuf = Buffer.from(label.labelData, 'base64')
      const image = await Jimp.read(inputBuf)
      const w = image.getWidth()
      const h = image.getHeight()
      const rotated = new Jimp(h, w, 0xFFFFFFFF)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          rotated.setPixelColor(image.getPixelColor(x, y), h - 1 - y, x)
        }
      }
      const rotatedBuf = await rotated.getBufferAsync(Jimp.MIME_PNG)
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
