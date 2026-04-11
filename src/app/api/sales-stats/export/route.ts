/**
 * GET /api/sales-stats/export
 *
 * CSV export — same filters as /api/sales-stats, returns downloadable CSV.
 */
import { NextRequest, NextResponse } from 'next/server'
import { stringify } from 'csv-stringify/sync'

export async function GET(req: NextRequest) {
  // Forward all params to the main sales-stats API
  const url = new URL('/api/sales-stats', req.nextUrl.origin)
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v))

  const res = await fetch(url, {
    headers: { cookie: req.headers.get('cookie') || '' },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed' }))
    return NextResponse.json(err, { status: res.status })
  }

  const data = await res.json()
  const rows = (data.rows ?? []).map((r: Record<string, unknown>) => ({
    SKU: r.sku,
    Title: r.title,
    Channel: r.channel,
    'Units Sold': r.unitsSold,
    Revenue: r.revenue,
    COGS: r.cogs,
    Commission: r.commission,
    Shipping: r.shipping,
    'Cost Codes': r.costCodes,
    Profit: r.profit,
    'Margin %': r.margin,
  }))

  const csv = stringify(rows, {
    header: true,
    columns: ['SKU', 'Title', 'Channel', 'Units Sold', 'Revenue', 'COGS', 'Commission', 'Shipping', 'Cost Codes', 'Profit', 'Margin %'],
  })

  const startDate = req.nextUrl.searchParams.get('startDate') || 'unknown'
  const endDate = req.nextUrl.searchParams.get('endDate') || 'unknown'

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sales-stats-${startDate}-to-${endDate}.csv"`,
    },
  })
}
