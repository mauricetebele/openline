/**
 * POST /api/marketplace-skus/bulk-delete
 * Body: { ids: string[] }
 *
 * Delete many marketplace SKU mappings at once (same effect as the per-row
 * delete: the mapping is removed; any synced marketplace listing stays and
 * becomes unmapped). Deletes one at a time so a single failure doesn't block
 * the rest; failures are returned per SKU.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: 'No SKUs selected' }, { status: 400 })

  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: { id: { in: ids } },
    select: { id: true, sellerSku: true },
  })

  const deletedIds: string[] = []
  const failed: { id: string; sellerSku: string; error: string }[] = []
  for (const m of mskus) {
    try {
      await prisma.productGradeMarketplaceSku.delete({ where: { id: m.id } })
      deletedIds.push(m.id)
    } catch (err: unknown) {
      failed.push({ id: m.id, sellerSku: m.sellerSku, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ deleted: deletedIds.length, deletedIds, failed })
}
