'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import jsPDF from 'jspdf'

interface AgingRow {
  customerId: string
  companyName: string
  current: number
  days1_30: number
  days31_60: number
  days61_90: number
  days91plus: number
  total: number
}

interface Totals {
  current: number
  days1_30: number
  days31_60: number
  days61_90: number
  days91plus: number
  total: number
}

function generateAgingPDF(rows: AgingRow[], totals: Totals) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('ACCOUNTS RECEIVABLE AGING REPORT', 40, 45)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, w - 40, 45, { align: 'right' })

  const cols = [
    { label: 'Customer',  x: 40,  w: 180, align: 'left' },
    { label: 'Current',   x: 240, w: 90,  align: 'right' },
    { label: '1–30 days', x: 335, w: 90,  align: 'right' },
    { label: '31–60',     x: 430, w: 90,  align: 'right' },
    { label: '61–90',     x: 525, w: 90,  align: 'right' },
    { label: '90+',       x: 620, w: 90,  align: 'right' },
    { label: 'Total',     x: 715, w: 90,  align: 'right' },
  ]

  let y = 70
  doc.setFillColor(245, 245, 245)
  doc.rect(40, y - 14, w - 80, 18, 'F')
  doc.setFont('helvetica', 'bold')
  cols.forEach((col) => {
    doc.text(col.label, col.x + (col.align === 'right' ? col.w : 0), y, { align: col.align as 'left' | 'right' })
  })
  y += 16

  doc.setFont('helvetica', 'normal')
  for (const row of rows) {
    if (y > 530) { doc.addPage(); y = 50 }
    doc.text(row.companyName.substring(0, 28), 40, y)
    doc.text(`$${row.current.toFixed(2)}`,   330, y, { align: 'right' })
    doc.text(`$${row.days1_30.toFixed(2)}`,  425, y, { align: 'right' })
    doc.text(`$${row.days31_60.toFixed(2)}`, 520, y, { align: 'right' })
    doc.text(`$${row.days61_90.toFixed(2)}`, 615, y, { align: 'right' })

    if (row.days91plus > 0) {
      doc.setTextColor(220, 38, 38)
    }
    doc.text(`$${row.days91plus.toFixed(2)}`, 710, y, { align: 'right' })
    doc.setTextColor(0, 0, 0)

    doc.setFont('helvetica', 'bold')
    doc.text(`$${row.total.toFixed(2)}`, w - 45, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 16
  }

  // Totals row
  y += 4
  doc.setLineWidth(0.5)
  doc.line(40, y, w - 40, y)
  y += 14
  doc.setFont('helvetica', 'bold')
  doc.text('TOTALS', 40, y)
  doc.text(`$${totals.current.toFixed(2)}`,   330, y, { align: 'right' })
  doc.text(`$${totals.days1_30.toFixed(2)}`,  425, y, { align: 'right' })
  doc.text(`$${totals.days31_60.toFixed(2)}`, 520, y, { align: 'right' })
  doc.text(`$${totals.days61_90.toFixed(2)}`, 615, y, { align: 'right' })

  if (totals.days91plus > 0) doc.setTextColor(220, 38, 38)
  doc.text(`$${totals.days91plus.toFixed(2)}`, 710, y, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  doc.text(`$${totals.total.toFixed(2)}`, w - 45, y, { align: 'right' })

  doc.save('Aging-Report.pdf')
}

export default function WholesaleAgingManager() {
  const router = useRouter()
  const [rows, setRows] = useState<AgingRow[]>([])
  const [totals, setTotals] = useState<Totals>({ current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days91plus: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [overdueOnly, setOverdueOnly] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch('/api/wholesale/aging')
        const data = await res.json()
        setRows(data.data ?? [])
        setTotals(data.totals ?? { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days91plus: 0, total: 0 })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  const displayRows = overdueOnly ? rows.filter((r) => r.days1_30 + r.days31_60 + r.days61_90 + r.days91plus > 0) : rows

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Aging Report</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="rounded"
            />
            Overdue only
          </label>
          <button
            onClick={() => generateAgingPDF(displayRows, totals)}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Print Aging Report
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : displayRows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No outstanding balances</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3">Customer</th>
                <th className="text-right px-5 py-3">Current</th>
                <th className="text-right px-5 py-3">1–30 days</th>
                <th className="text-right px-5 py-3">31–60</th>
                <th className="text-right px-5 py-3">61–90</th>
                <th className="text-right px-5 py-3">90+</th>
                <th className="text-right px-5 py-3 font-bold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayRows.map((row) => (
                <tr
                  key={row.customerId}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/wholesale/customers/${row.customerId}`)}
                >
                  <td className="px-5 py-3 font-medium">
                    <Link
                      href={`/wholesale/customers/${row.customerId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-orange-600"
                    >
                      {row.companyName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-500">{row.current > 0 ? fmt(row.current) : '—'}</td>
                  <td className="px-5 py-3 text-right text-yellow-600">{row.days1_30 > 0 ? fmt(row.days1_30) : '—'}</td>
                  <td className="px-5 py-3 text-right text-orange-500">{row.days31_60 > 0 ? fmt(row.days31_60) : '—'}</td>
                  <td className="px-5 py-3 text-right text-red-500">{row.days61_90 > 0 ? fmt(row.days61_90) : '—'}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${row.days91plus > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                    {row.days91plus > 0 ? fmt(row.days91plus) : '—'}
                  </td>
                  <td className="px-5 py-3 text-right font-bold">{fmt(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold text-sm">
                <td className="px-5 py-3">TOTALS</td>
                <td className="px-5 py-3 text-right">{fmt(totals.current)}</td>
                <td className="px-5 py-3 text-right">{fmt(totals.days1_30)}</td>
                <td className="px-5 py-3 text-right">{fmt(totals.days31_60)}</td>
                <td className="px-5 py-3 text-right">{fmt(totals.days61_90)}</td>
                <td className={`px-5 py-3 text-right ${totals.days91plus > 0 ? 'text-red-600' : ''}`}>
                  {fmt(totals.days91plus)}
                </td>
                <td className="px-5 py-3 text-right">{fmt(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}
