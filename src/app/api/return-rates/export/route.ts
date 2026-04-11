import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { stringify } from 'csv-stringify/sync'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Proxy to main return-rates API and convert to CSV
  const base = req.nextUrl.origin
  const qs = req.nextUrl.searchParams.toString()
  const res = await fetch(`${base}/api/return-rates?${qs}`, {
    headers: { cookie: req.headers.get('cookie') || '' },
  })
  if (!res.ok) return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })

  const data = await res.json()
  const rows = (data.rows ?? []).map((r: Record<string, unknown>) => ({
    SKU: r.sku,
    Title: r.title,
    Grade: r.grade ?? '',
    Channel: r.channel,
    'Units Sold': r.unitsSold,
    'Units Returned': r.unitsReturned,
    'Return Rate %': r.returnRate,
    'Top Return Reason': r.topReturnReason,
  }))

  const csv = stringify(rows, {
    header: true,
    columns: ['SKU', 'Title', 'Grade', 'Channel', 'Units Sold', 'Units Returned', 'Return Rate %', 'Top Return Reason'],
  })

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="return-rates-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
