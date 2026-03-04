import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { decrypt } from '@/lib/crypto'
import { ShipStationClient, SSLabelPayload } from '@/lib/shipstation/client'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await prisma.shipStationAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!account) return NextResponse.json({ error: 'No ShipStation account connected' }, { status: 404 })

  const body: SSLabelPayload = await req.json()
  const client = new ShipStationClient(decrypt(account.apiKeyEnc), account.apiSecretEnc ? decrypt(account.apiSecretEnc) : '')

  try {
    const label = await client.createLabel(body)
    return NextResponse.json(label)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create label' },
      { status: 502 },
    )
  }
}
