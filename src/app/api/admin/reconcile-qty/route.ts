import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { reconcileSerialQty } from '@/lib/reconcile-serial-qty'

export const dynamic = 'force-dynamic'

/** GET /api/admin/reconcile-qty?dryRun=true — report mismatches without fixing */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dryRun = req.nextUrl.searchParams.get('dryRun') !== 'false'
  const result = await reconcileSerialQty(dryRun)
  return NextResponse.json(result)
}

/** POST /api/admin/reconcile-qty — fix all mismatches */
export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await reconcileSerialQty(false)
  return NextResponse.json(result)
}
