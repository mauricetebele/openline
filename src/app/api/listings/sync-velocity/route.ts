import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { syncSalesVelocity } from '@/lib/amazon/sales-velocity'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

const schema = z.object({
  accountId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const adminErr = requireAdmin(user)
    if (adminErr) return adminErr

    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
    }

    const { accountId } = parsed.data

    const account = await prisma.amazonAccount.findUnique({ where: { id: accountId, isActive: true } })
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const result = await syncSalesVelocity(accountId)

    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/listings/sync-velocity]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
