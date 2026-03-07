/**
 * POST /api/fba-refunds/validate
 * Manual validation — marks specific refund IDs as VALIDATED.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const ids: string[] = body.ids

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids[] is required' }, { status: 400 })
  }

  await prisma.fbaRefund.updateMany({
    where: { id: { in: ids } },
    data: {
      validationStatus: 'VALIDATED',
      validatedAt: new Date(),
      validationReason: 'Manual validation',
      validationSource: 'manual',
    },
  })

  return NextResponse.json({ ok: true, validated: ids.length })
}
