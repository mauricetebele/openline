/**
 * POST /api/veeqo/credentials/test — validate a Veeqo API key against the API.
 * Body: { apiKey? }. If apiKey is omitted, tests the saved credential and records
 * the result on it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { testVeeqoConnection } from '@/lib/veeqo/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { apiKey } = await req.json().catch(() => ({})) as { apiKey?: string }
  const result = await testVeeqoConnection(apiKey?.trim() || undefined)

  // When testing the saved credential, record the outcome.
  if (!apiKey?.trim()) {
    const cred = await prisma.veeqoCredential.findFirst({ where: { isActive: true } })
    if (cred) {
      await prisma.veeqoCredential.update({
        where: { id: cred.id },
        data: { lastTestedAt: new Date(), lastTestOk: result.ok },
      }).catch(() => {})
    }
  }

  return NextResponse.json(result)
}
