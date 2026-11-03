/**
 * GET /api/repair-orders/[id]/po-document
 * Repair PO as an .xlsx: vendor, creation date, serials, repair type, repair cost
 * requested, and a total. Opens directly in Excel.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { buildRepairPoXlsx } from '@/lib/repair-po-xlsx'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const file = await buildRepairPoXlsx(params.id)
  if (!file) return NextResponse.json({ error: 'Repair order not found' }, { status: 404 })

  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
    },
  })
}
