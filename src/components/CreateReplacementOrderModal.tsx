'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Plus, Trash2, Search, Loader2, RotateCcw, CheckCircle2 } from 'lucide-react'

interface ProductResult {
  id: string
  sku: string
  description: string
  inventoryItems: { qty: number; gradeId: string | null; grade: { grade: string } | null }[]
}
interface GradeOption { id: string; grade: string }

export interface ReplacementSourceItem {
  sellerSku: string | null
  title: string | null
  quantityOrdered: number
}

interface ReplLine {
  _key: string
  productId: string          // '' until a product is confirmed
  sku: string                // internal Product.sku written to sellerSku
  title: string
  gradeId: string            // '' until a grade is chosen
  quantity: number
  search: string
  results: ProductResult[]
  searching: boolean
  invMap: ProductResult['inventoryItems']
}

let keyCounter = 0
const blankLine = (over: Partial<ReplLine> = {}): ReplLine => ({
  _key: `repl-${++keyCounter}`,
  productId: '', sku: '', title: '', gradeId: '', quantity: 1,
  search: '', results: [], searching: false, invMap: [],
  ...over,
})

export default function CreateReplacementOrderModal({
  orderId, sourceItems, onClose, onCreated,
}: {
  orderId: string
  sourceItems: ReplacementSourceItem[]
  onClose: () => void
  onCreated: (order: { id: string; olmNumber: number | null }) => void
}) {
  const [grades, setGrades] = useState<GradeOption[]>([])
  const [lines, setLines] = useState<ReplLine[]>(() =>
    (sourceItems.length ? sourceItems : [{ sellerSku: null, title: null, quantityOrdered: 1 }])
      .map(si => blankLine({
        quantity: Math.max(1, si.quantityOrdered || 1),
        // Seed the search box with the original SKU/title so matches surface fast.
        search: (si.sellerSku || si.title || '').trim(),
        title: si.title || '',
      })),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    fetch('/api/grades').then(r => r.json()).then(d => setGrades(d.data ?? d)).catch(() => {})
  }, [])

  const patch = useCallback((key: string, over: Partial<ReplLine>) => {
    setLines(prev => prev.map(l => l._key === key ? { ...l, ...over } : l))
  }, [])

  const runSearch = useCallback(async (key: string, q: string) => {
    if (!q.trim()) { patch(key, { results: [], searching: false }); return }
    patch(key, { searching: true })
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(q)}`)
      const data = await res.json()
      patch(key, { results: (data.data ?? data) as ProductResult[], searching: false })
    } catch {
      patch(key, { results: [], searching: false })
    }
  }, [patch])

  // Debounced search per line whenever its unconfirmed search text changes.
  const onSearchChange = (key: string, q: string) => {
    patch(key, { search: q, productId: '', sku: '' })
    clearTimeout(debounceRef.current[key])
    debounceRef.current[key] = setTimeout(() => runSearch(key, q), 250)
  }

  // Auto-search each seeded line once on mount so results appear immediately.
  useEffect(() => {
    lines.forEach(l => { if (l.search && !l.productId) runSearch(l._key, l.search) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectProduct(key: string, p: ProductResult) {
    patch(key, {
      productId: p.id, sku: p.sku, title: p.description,
      search: p.sku, results: [], invMap: p.inventoryItems ?? [], gradeId: '',
    })
  }

  function gradeAvailability(invMap: ReplLine['invMap']): Record<string, number> {
    const byGrade: Record<string, number> = {}
    for (const it of invMap) {
      const gid = it.gradeId ?? ''
      byGrade[gid] = (byGrade[gid] ?? 0) + it.qty
    }
    return byGrade
  }

  const allResolved = lines.length > 0 && lines.every(l => l.productId && l.gradeId)

  async function submit() {
    if (!allResolved || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/create-replacement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: lines.map(l => ({
            sellerSku: l.sku,
            title: l.title,
            quantityOrdered: l.quantity,
            gradeId: l.gradeId,
            itemPrice: 0,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create replacement order')
      onCreated(json.order)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create replacement order')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-lg shadow-xl my-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-white/10">
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
            <RotateCcw size={16} className="text-blue-600" /> Create Replacement Order
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Confirm the product and grade for each replacement unit. This creates a new
            BackMarket <span className="font-semibold">Replacement</span> order in the fulfillment
            grid for normal processing. Replacement orders do not affect the profitability report.
          </p>

          {lines.map((l, idx) => {
            const avail = gradeAvailability(l.invMap)
            return (
              <div key={l._key} className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Item {idx + 1}</span>
                  {lines.length > 1 && (
                    <button
                      onClick={() => setLines(prev => prev.filter(x => x._key !== l._key))}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {/* Product picker */}
                {l.productId ? (
                  <div className="flex items-center gap-2 text-xs bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/40 rounded-md px-2.5 py-2">
                    <CheckCircle2 size={14} className="text-green-600 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-semibold text-gray-900 dark:text-white truncate">{l.sku}</div>
                      <div className="text-gray-500 truncate">{l.title}</div>
                    </div>
                    <button
                      onClick={() => patch(l._key, { productId: '', sku: '', gradeId: '', results: [], invMap: [] })}
                      className="text-[11px] text-blue-600 hover:underline shrink-0"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="flex items-center gap-1.5 border border-gray-300 dark:border-white/15 rounded-md px-2.5 py-1.5">
                      <Search size={13} className="text-gray-400 shrink-0" />
                      <input
                        autoFocus={idx === 0}
                        value={l.search}
                        onChange={e => onSearchChange(l._key, e.target.value)}
                        placeholder="Search product by SKU or description…"
                        className="w-full text-xs bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400"
                      />
                      {l.searching && <Loader2 size={13} className="animate-spin text-gray-400 shrink-0" />}
                    </div>
                    {l.results.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-md shadow-lg">
                        {l.results.map(p => {
                          const total = p.inventoryItems?.reduce((s, i) => s + i.qty, 0) ?? 0
                          return (
                            <button
                              key={p.id}
                              onClick={() => selectProduct(l._key, p)}
                              className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-white/5 last:border-0"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-xs font-semibold text-gray-900 dark:text-white truncate">{p.sku}</span>
                                <span className="text-[10px] text-gray-400 shrink-0">{total} in stock</span>
                              </div>
                              <div className="text-[11px] text-gray-500 truncate">{p.description}</div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Grade + quantity */}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Grade</label>
                    <select
                      value={l.gradeId}
                      onChange={e => patch(l._key, { gradeId: e.target.value })}
                      disabled={!l.productId}
                      className="w-full text-xs border border-gray-300 dark:border-white/15 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50"
                    >
                      <option value="">Select grade…</option>
                      {grades.map(g => {
                        const n = avail[g.id]
                        return (
                          <option key={g.id} value={g.id}>
                            {g.grade}{l.productId && n != null ? ` (${n} in stock)` : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div className="w-24">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Qty</label>
                    <input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={e => patch(l._key, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                      className="w-full text-xs border border-gray-300 dark:border-white/15 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            )
          })}

          <button
            onClick={() => setLines(prev => [...prev, blankLine()])}
            className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            <Plus size={14} /> Add item
          </button>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-200 dark:border-white/10">
          <p className="text-[11px] text-gray-400">
            {allResolved ? 'Ready to create.' : 'Confirm a product and grade for every item.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-xs font-medium text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!allResolved || submitting}
              className="flex items-center gap-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-md transition-colors"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {submitting ? 'Creating…' : 'Confirm & Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
