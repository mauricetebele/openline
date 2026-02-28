import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { encrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.')
  if (parts.length < 2) throw new Error('Invalid JWT format')
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { internalJwt, defaultShipFromId, amazonCarrierId, v2ApiKey } = body
  const updates: Record<string, unknown> = {}

  if (internalJwt) {
    const cleanJwt = (internalJwt as string).replace(/\s+/g, '')
    let claims: Record<string, unknown>
    try {
      claims = decodeJwtPayload(cleanJwt)
    } catch {
      return NextResponse.json({ error: 'Invalid JWT — could not decode payload' }, { status: 400 })
    }

    const exp = claims['exp'] as number | undefined
    const internalJwtExp = exp ? new Date(exp * 1000) : null

    if (internalJwtExp && internalJwtExp < new Date()) {
      return NextResponse.json(
        { error: 'This JWT has already expired. Please get a fresh token from ShipStation.' },
        { status: 400 },
      )
    }

    const partitionRaw = claims['http://shipstation.com/partition'] as string | undefined
    const partition = partitionRaw ? parseInt(partitionRaw, 10) : null
    const internalSellerId = (claims['http://shipstation.com/seller_id'] as string | undefined) ?? null
    const sub = (claims['sub'] as string | undefined) ?? ''
    const internalUserId = sub.includes('|') ? sub.split('|').pop()! : sub

    updates.internalJwtEnc   = encrypt(cleanJwt)
    updates.internalJwtExp   = internalJwtExp
    updates.partition        = partition
    updates.internalSellerId = internalSellerId
    updates.internalUserId   = internalUserId || null
  }

  if (defaultShipFromId !== undefined) {
    updates.defaultShipFromId = (defaultShipFromId as string)?.trim() || null
  }

  if (amazonCarrierId !== undefined) {
    updates.amazonCarrierId = (amazonCarrierId as string)?.trim() || null
  }

  if (v2ApiKey !== undefined) {
    const clean = (v2ApiKey as string)?.trim() || null
    updates.v2ApiKeyEnc = clean ? encrypt(clean) : null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const account = await prisma.shipStationAccount.update({
    where: { id: params.id },
    data: updates,
    select: {
      id: true, name: true, isActive: true,
      partition: true, internalJwtExp: true, defaultShipFromId: true,
    },
  })
  return NextResponse.json(account)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.shipStationAccount.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
