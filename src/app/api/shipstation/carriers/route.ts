import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
  })
  if (!account) return NextResponse.json({ error: 'No ShipStation account connected' }, { status: 404 })

  const v2ApiKey = account.v2ApiKeyEnc ? decrypt(account.v2ApiKeyEnc) : null
  const client = new ShipStationClient(decrypt(account.apiKeyEnc), decrypt(account.apiSecretEnc), v2ApiKey)

  const [v1Result, v2Result] = await Promise.allSettled([
    client.getCarriers(),
    client.getV2Carriers(),
  ])

  return NextResponse.json({
    v1: v1Result.status === 'fulfilled'
      ? { ok: true, carriers: v1Result.value.map(c => ({ code: c.code, name: c.name, nickname: c.nickname, isAmazon: c.code.toLowerCase().includes('amazon') })) }
      : { ok: false, error: (v1Result.reason as Error).message },
    v2: v2Result.status === 'fulfilled'
      ? { ok: true, carriers: v2Result.value.carriers.map(c => ({ carrier_id: c.carrier_id, carrier_code: c.carrier_code, nickname: c.nickname, friendly_name: c.friendly_name })) }
      : { ok: false, error: (v2Result.reason as Error).message },
  })
}
