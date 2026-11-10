/**
 * Device agent command queue (for cfgutil "prepare" / skip-setup, etc.).
 *
 * Browser (session auth):
 *   POST { type: 'prepare', udid? }   → queue a command, returns { id }
 *   GET  ?id=<id>                      → poll that command's status
 *
 * Agent (Authorization: Bearer <agent token>):
 *   POST { action: 'claim' }                          → claim oldest PENDING (→ RUNNING), returns { command | null }
 *   POST { action: 'result', id, status, result?, error? }  → report DONE/FAILED
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

async function userFromBearer(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return null
  const row = await prisma.deviceAgentToken.findUnique({ where: { token }, select: { userId: true } })
  return row?.userId ?? null
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  const command = id
    ? await prisma.deviceAgentCommand.findFirst({ where: { id, userId: user.dbId } })
    : await prisma.deviceAgentCommand.findFirst({ where: { userId: user.dbId }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ command })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { action?: string; type?: string; udid?: string; id?: string; status?: string; result?: string; error?: string }

  // ── Agent (token) paths ─────────────────────────────────────────────────────
  const agentUserId = await userFromBearer(req)
  if (agentUserId) {
    if (body.action === 'claim') {
      const next = await prisma.deviceAgentCommand.findFirst({ where: { userId: agentUserId, status: 'PENDING' }, orderBy: { createdAt: 'asc' } })
      if (!next) return NextResponse.json({ command: null })
      const claimed = await prisma.deviceAgentCommand.update({ where: { id: next.id }, data: { status: 'RUNNING', ...(body.udid ? { udid: body.udid } : {}) } })
      return NextResponse.json({ command: claimed })
    }
    if (body.action === 'result' && body.id) {
      const status = body.status === 'DONE' || body.status === 'FAILED' ? body.status : 'DONE'
      await prisma.deviceAgentCommand.updateMany({
        where: { id: body.id, userId: agentUserId },
        data: { status, result: body.result?.slice(0, 8000) ?? null, error: body.error?.slice(0, 8000) ?? null },
      })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Unknown agent action' }, { status: 400 })
  }

  // ── Browser (session) path: queue a command ─────────────────────────────────
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const type = body.type === 'prepare' ? 'prepare' : null
  if (!type) return NextResponse.json({ error: 'Unsupported command type' }, { status: 400 })

  // Avoid piling up duplicates — clear any stale PENDING of the same type first.
  await prisma.deviceAgentCommand.updateMany({
    where: { userId: user.dbId, type, status: 'PENDING' },
    data: { status: 'FAILED', error: 'Superseded by a newer request' },
  })
  const command = await prisma.deviceAgentCommand.create({
    data: { userId: user.dbId, type, status: 'PENDING', udid: body.udid ?? null },
  })
  return NextResponse.json({ command })
}
