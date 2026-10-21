/**
 * GET /api/fba-return-receipts/validate-lpn?lpn=...&fnsku=...
 * Checks an LPN against the FBA Customer Returns data (fba_returns) to confirm it
 * belongs to the expected FNSKU for the removal-shipment line item being received.
 *
 * status: 'match'    — LPN found and its FNSKU matches
 *         'mismatch' — LPN found but belongs to a different FNSKU (wrong unit)
 *         'unknown'  — LPN not in the returns data yet (can't verify)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lpn = req.nextUrl.searchParams.get('lpn')?.trim()
  const fnsku = req.nextUrl.searchParams.get('fnsku')?.trim()
  if (!lpn) return NextResponse.json({ error: 'lpn is required' }, { status: 400 })

  const ret = await prisma.fbaReturn.findFirst({
    where: { lpn },
    orderBy: { returnDate: 'desc' },
    select: { fnsku: true, sku: true, title: true, reason: true },
  })

  if (!ret) return NextResponse.json({ status: 'unknown', lpn })

  const lpnFnsku = ret.fnsku ?? null
  const status = fnsku && lpnFnsku
    ? (lpnFnsku.toUpperCase() === fnsku.toUpperCase() ? 'match' : 'mismatch')
    : 'unknown'

  return NextResponse.json({ status, lpn, lpnFnsku, expectedFnsku: fnsku ?? null, sku: ret.sku, title: ret.title })
}
