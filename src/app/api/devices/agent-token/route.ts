/**
 * GET  /api/devices/agent-token  → the current user's agent token (creates one if none).
 * POST /api/devices/agent-token  → regenerate (invalidates the old token).
 *
 * The desktop device agent uses this token (Bearer) to post scans.
 */
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

function newToken() {
  return `olda_${randomBytes(24).toString('hex')}`
}

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let row = await prisma.deviceAgentToken.findFirst({ where: { userId: user.dbId }, orderBy: { createdAt: 'desc' } })
  if (!row) {
    row = await prisma.deviceAgentToken.create({ data: { token: newToken(), userId: user.dbId } })
  }
  return NextResponse.json({ token: row.token, lastSeenAt: row.lastSeenAt, createdAt: row.createdAt })
}

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Drop existing tokens for this user, issue a fresh one.
  await prisma.deviceAgentToken.deleteMany({ where: { userId: user.dbId } })
  const row = await prisma.deviceAgentToken.create({ data: { token: newToken(), userId: user.dbId } })
  return NextResponse.json({ token: row.token, lastSeenAt: null, createdAt: row.createdAt })
}
