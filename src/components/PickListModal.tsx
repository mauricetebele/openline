'use client'
import { useState, useEffect, useMemo } from 'react'
import { X, Printer, Loader2, MapPin } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PickReservation {
  locationName: string
  warehouseName: string
  qtyReserved: number
}

interface PickItem {
  orderItemId: string
  sellerSku: string | null
  title: string | null
  quantityOrdered: number
  binLocations: string[]
  reservations: PickReservation[]
}

interface PickOrder {
  id: string
  olmNumber: number | null
  amazonOrderId: string
  workflowStatus: string
  shipToName: string | null
  shipToCity: string | null
  shipToState: string | null
  items: PickItem[]
}

interface AggregatedItem {
  sellerSku: string | null
  title: string | null
  totalQty: number
  binLocations: string[]
  reservations: PickReservation[]
}

interface Props {
  orderIds: string[]
  showLocations: boolean   // true for PROCESSING/AWAITING tabs, false for PENDING
  onClose: () => void
}

// ─── HTML escape helper ───────────────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── Build printable HTML string ─────────────────────────────────────────────

function buildPrintHtml(opts: {
  aggregated: AggregatedItem[]
  totalUnits: number
  generatedAt: string
  showLocations: boolean
  pageSize: '4x6' | 'full'
}): string {
  const { aggregated, totalUnits, generatedAt, showLocations, pageSize } = opts
  const is4x6 = pageSize === '4x6'

  const rowsHtml = aggregated.map(item => {
    const binHtml = item.binLocations.length > 0
      ? `<br/><span class="bin-val">Bin: ${item.binLocations.map(b => esc(b)).join(', ')}</span>`
      : ''
    const locationCell = showLocations ? `<td class="loc">${
      item.reservations.length > 0
        ? item.reservations.map(r =>
            `<span class="loc-val">${esc(r.warehouseName)} / ${esc(r.locationName)}${
              item.reservations.length > 1 ? ` <span class="loc-qty">(×${r.qtyReserved})</span>` : ''
            }</span>`
          ).join('<br/>') + binHtml
        : binHtml ? `<span class="loc-val">—</span>${binHtml}` : '—'
    }</td>` : ''
    return `<tr>
      <td class="sku">${esc(item.sellerSku ?? '—')}</td>
      <td class="desc">${esc(item.title ?? '—')}</td>
      <td class="qty">${item.totalQty}</td>
      ${locationCell}
      <td class="chk"><span class="checkbox"></span></td>
    </tr>`
  }).join('\n')

  const locationTh = showLocations ? '<th>Location</th>' : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @page {
    ${is4x6
      ? 'size: 4in 6in; margin: 0.12in;'
      : 'size: letter; margin: 0.5in;'}
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: ${is4x6 ? '7.5pt' : '10pt'};
    color: #111;
    background: white;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: ${is4x6 ? '1.5pt' : '2pt'} solid #111;
    padding-bottom: ${is4x6 ? '4pt' : '8pt'};
    margin-bottom: ${is4x6 ? '5pt' : '12pt'};
  }
  .header h1 {
    font-size: ${is4x6 ? '11pt' : '18pt'};
    font-weight: 900;
    letter-spacing: -0.3px;
    line-height: 1;
  }
  .header-sub {
    font-size: ${is4x6 ? '5.5pt' : '8pt'};
    color: #666;
    margin-top: ${is4x6 ? '1pt' : '3pt'};
  }
  .header-right {
    text-align: right;
    font-size: ${is4x6 ? '6pt' : '8pt'};
    color: #555;
    line-height: 1.4;
  }
  .header-right strong {
    color: #333;
    font-size: ${is4x6 ? '7pt' : '9pt'};
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    font-size: ${is4x6 ? '6pt' : '8pt'};
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: ${is4x6 ? '2pt 3pt' : '4pt 8pt'};
    border-bottom: 1px solid #d1d5db;
    background: #f3f4f6;
    text-align: left;
    white-space: nowrap;
  }
  th.center { text-align: center; }
  td {
    padding: ${is4x6 ? '2pt 3pt' : '5pt 8pt'};
    border-bottom: 1px solid #f3f4f6;
    vertical-align: top;
    font-size: ${is4x6 ? '7pt' : '9.5pt'};
  }
  td.sku {
    font-family: 'Courier New', monospace;
    font-size: ${is4x6 ? '7pt' : '9pt'};
    font-weight: 700;
    white-space: nowrap;
    color: #1a1a1a;
  }
  td.desc {
    color: #444;
    max-width: ${is4x6 ? '90pt' : '220pt'};
    word-break: break-word;
    font-size: ${is4x6 ? '6.5pt' : '9pt'};
  }
  td.qty {
    font-weight: 800;
    font-size: ${is4x6 ? '8pt' : '11pt'};
    text-align: center;
    white-space: nowrap;
  }
  td.loc {
    font-size: ${is4x6 ? '6pt' : '8.5pt'};
  }
  td.chk { text-align: center; }
  .loc-val {
    display: block;
    font-weight: 700;
    color: #3730a3;
    white-space: nowrap;
  }
  .loc-qty { font-weight: 400; color: #9ca3af; }
  .bin-val {
    display: block;
    font-size: ${is4x6 ? '5.5pt' : '7.5pt'};
    color: #6b7280;
    margin-top: 1pt;
  }
  .checkbox {
    display: inline-block;
    width: ${is4x6 ? '9pt' : '12pt'};
    height: ${is4x6 ? '9pt' : '12pt'};
    border: 1px solid #9ca3af;
    border-radius: 2px;
  }
  .footer {
    margin-top: ${is4x6 ? '6pt' : '16pt'};
    padding-top: ${is4x6 ? '3pt' : '8pt'};
    border-top: 1px solid #d1d5db;
    text-align: center;
    font-size: ${is4x6 ? '5.5pt' : '7.5pt'};
    color: #9ca3af;
  }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>PICK LIST</h1>
    ${showLocations ? '<div class="header-sub">Locations from reserved inventory</div>' : ''}
  </div>
  <div class="header-right">
    <div>${esc(generatedAt)}</div>
    <div><strong>${aggregated.length} SKU${aggregated.length !== 1 ? 's' : ''} · ${totalUnits} unit${totalUnits !== 1 ? 's' : ''}</strong></div>
  </div>
</div>
<table>
  <thead>
    <tr>
      <th>SKU</th>
      <th>Description</th>
      <th class="center">Qty</th>
      ${locationTh}
      <th class="center">✓</th>
    </tr>
  </thead>
  <tbody>
    ${rowsHtml}
  </tbody>
</table>
<div class="footer">
  ${aggregated.length} SKUs · ${totalUnits} units · Generated ${esc(generatedAt)}
</div>
</body>
</html>`
}

// ─── iframe print helper ──────────────────────────────────────────────────────

function printViaIframe(html: string) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;border:none;'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument!
  doc.open()
  doc.write(html)
  doc.close()

  // Use onload; fall back to setTimeout
  let printed = false
  function doPrint() {
    if (printed) return
    printed = true
    iframe.contentWindow!.focus()
    iframe.contentWindow!.print()
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe)
    }, 1000)
  }

  iframe.onload = doPrint
  setTimeout(doPrint, 400)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PickListModal({ orderIds, showLocations, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [orders, setOrders]   = useState<PickOrder[]>([])
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (orderIds.length === 0) return
    fetch(`/api/orders/pick-list?orderIds=${encodeURIComponent(orderIds.join(','))}`)
      .then(r => r.ok
        ? r.json()
        : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error ?? 'Failed to load'))))
      .then(data => { setOrders(data.orders); setLoading(false) })
      .catch(e  => { setError(e.message); setLoading(false) })
  }, [orderIds])

  // Aggregate items by SKU across all orders
  const aggregated = useMemo<AggregatedItem[]>(() => {
    const map = new Map<string, AggregatedItem>()
    for (const order of orders) {
      for (const item of order.items) {
        const key = item.sellerSku ?? '\x00'
        const existing = map.get(key)
        if (existing) {
          existing.totalQty += item.quantityOrdered
          existing.reservations.push(...item.reservations)
          for (const b of item.binLocations) {
            if (!existing.binLocations.includes(b)) existing.binLocations.push(b)
          }
        } else {
          map.set(key, {
            sellerSku:    item.sellerSku,
            title:        item.title,
            totalQty:     item.quantityOrdered,
            binLocations: [...item.binLocations],
            reservations: [...item.reservations],
          })
        }
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.sellerSku ?? '').localeCompare(b.sellerSku ?? ''))
  }, [orders])

  const totalUnits = aggregated.reduce((s, i) => s + i.totalQty, 0)

  const generatedAt = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })

  function handlePrint(pageSize: '4x6' | 'full') {
    const html = buildPrintHtml({ aggregated, totalUnits, generatedAt, showLocations, pageSize })
    printViaIframe(html)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl">

        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Pick List</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {aggregated.length} SKU{aggregated.length !== 1 ? 's' : ''} · {totalUnits} unit{totalUnits !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePrint('4x6')}
              disabled={loading || !!error}
              className="flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              <Printer size={14} /> Print 4×6
            </button>
            <button
              onClick={() => handlePrint('full')}
              disabled={loading || !!error}
              className="flex items-center gap-2 bg-amazon-blue text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              <Printer size={14} /> Print / Save PDF
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable body — preview */}
        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={18} className="animate-spin mr-2" /> Loading pick list…
            </div>
          )}
          {error && (
            <p className="text-red-600 text-sm text-center py-8">{error}</p>
          )}

          {!loading && !error && (
            <div>
              {/* Preview header */}
              <div className="mb-5 pb-4 border-b-2 border-gray-900">
                <div className="flex items-end justify-between">
                  <div>
                    <h1 className="text-2xl font-black tracking-tight text-gray-900">Pick List</h1>
                    {showLocations && (
                      <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                        <MapPin size={10} /> Locations from reserved inventory
                      </p>
                    )}
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p>{generatedAt}</p>
                    <p className="font-semibold text-gray-700 mt-0.5">
                      {aggregated.length} SKU{aggregated.length !== 1 ? 's' : ''} · {totalUnits} unit{totalUnits !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Preview table */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">SKU</th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                      <th className="px-4 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wide w-12">Qty</th>
                      {showLocations && (
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Location</th>
                      )}
                      <th className="px-4 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wide w-10">✓</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregated.map((item, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-3 font-mono text-[12px] font-semibold text-gray-800 whitespace-nowrap align-top">
                          {item.sellerSku ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 align-top max-w-[200px]">
                          {item.title ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-gray-900 align-top text-sm">
                          {item.totalQty}
                        </td>
                        {showLocations && (
                          <td className="px-4 py-3 text-xs align-top">
                            {item.reservations.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                {item.reservations.map((r, j) => (
                                  <span key={j} className="font-semibold text-indigo-700 whitespace-nowrap">
                                    {r.warehouseName} / {r.locationName}
                                    {item.reservations.length > 1 && (
                                      <span className="text-gray-400 font-normal ml-1">(×{r.qtyReserved})</span>
                                    )}
                                  </span>
                                ))}
                                {item.binLocations.length > 0 && (
                                  <span className="text-gray-500 text-[10px]">Bin: {item.binLocations.join(', ')}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-center align-top">
                          <span className="inline-block w-4 h-4 border border-gray-400 rounded-sm" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="mt-6 pt-4 border-t border-gray-300 text-[10px] text-gray-400 text-center">
                {aggregated.length} SKUs · {totalUnits} units · Generated {generatedAt}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
