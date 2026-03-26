import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { productIds, packagePresetId } = body as { productIds: string[]; packagePresetId: string | null }

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return NextResponse.json({ error: 'No products specified' }, { status: 400 })
  }

  // Validate preset exists if provided
  if (packagePresetId) {
    const preset = await prisma.packagePreset.findUnique({ where: { id: packagePresetId } })
    if (!preset) return NextResponse.json({ error: 'Package preset not found' }, { status: 404 })
  }

  const result = await prisma.product.updateMany({
    where: { id: { in: productIds } },
    data: { defaultPackagePresetId: packagePresetId ?? null },
  })

  return NextResponse.json({ updated: result.count })
}
