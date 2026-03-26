'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

interface SearchResult {
  id: string
  olmNumber: number | null
  amazonOrderId: string
  orderSource: string
  workflowStatus: string
  shipToName: string | null
  purchaseDate: string
}

const STATUS_COLOR: Record<string, string> = {
  PENDING:               'bg-yellow-100 text-yellow-800',
  PROCESSING:            'bg-blue-100 text-blue-800',
  AWAITING_VERIFICATION: 'bg-purple-100 text-purple-800',
  SHIPPED:               'bg-green-100 text-green-800',
  CANCELLED:             'bg-red-100 text-red-800',
}
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', PROCESSING: 'Unshipped', AWAITING_VERIFICATION: 'Awaiting',
  SHIPPED: 'Shipped', CANCELLED: 'Cancelled',
}

export default function OrderSearchDropdown({ mobile }: { mobile?: boolean }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const abortRef = useRef<AbortController>()

  const doSearch = useCallback(async (q: string) => {
    abortRef.current?.abort()
    if (q.length < 2) { setResults([]); setOpen(false); return }

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)

    try {
      const res = await fetch(`/api/orders/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      const json = await res.json()
      setResults(json.data ?? [])
      setOpen(true)
    } catch {
      // aborted or network error
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query), 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, doSearch])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); setQuery('') }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  function handleSelect(id: string) {
    setOpen(false)
    setQuery('')
    router.push(`/orders/${id}`)
  }

  async function handleEnter() {
    // Read directly from DOM — React state may not have updated yet after paste
    const q = (inputRef.current?.value ?? query).trim()
    if (!q) return

    // Kill any pending debounce so it doesn't fight us
    clearTimeout(debounceRef.current)
    abortRef.current?.abort()

    // Sync React state to what's in the input
    setQuery(q)

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    try {
      const res = await fetch(`/api/orders/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      const json = await res.json()
      const data: SearchResult[] = json.data ?? []

      // Single result or exact match → navigate immediately
      if (data.length === 1) { handleSelect(data[0].id); return }
      const match = data.find(
        r => r.amazonOrderId === q || (r.olmNumber && `OLM-${r.olmNumber}` === q) || String(r.olmNumber) === q,
      )
      if (match) { handleSelect(match.id); return }

      // No exact match — show results dropdown
      setResults(data)
      setOpen(true)
    } catch { /* aborted */ }
    if (!ctrl.signal.aborted) setLoading(false)
  }

  return (
    <div ref={containerRef} className={clsx('relative', mobile ? 'w-full' : 'w-64')}>
      <div className={clsx(
        'flex items-center gap-2 rounded-md border transition-all',
        mobile
          ? 'bg-gray-800 border-white/10 px-3 py-2'
          : 'bg-gray-800/60 border-white/[0.15] hover:border-white/25 focus-within:border-amazon-orange/50 focus-within:bg-gray-800/80 px-2.5 py-1.5',
      )}>
        {loading
          ? <Loader2 size={14} className="text-gray-400 animate-spin shrink-0" />
          : <Search size={14} className="text-gray-400 shrink-0" />}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleEnter() } }}
          onFocus={() => { if (results.length > 0) setOpen(true) }}
          placeholder="Search orders..."
          className="bg-transparent text-sm text-white placeholder:text-gray-400 outline-none w-full"
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false) }}
            className="text-gray-500 hover:text-gray-300 shrink-0">
            <X size={14} />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className={clsx(
          'absolute z-[9999] mt-1 w-full min-w-[320px] max-h-[400px] overflow-y-auto',
          'bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl',
          mobile ? 'left-0' : 'right-0',
        )}>
          {results.map(r => (
            <button
              key={r.id}
              onClick={() => handleSelect(r.id)}
              className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-white/5 last:border-0 transition-colors"
            >
              <div className="flex items-center gap-2 flex-wrap">
                {r.olmNumber && (
                  <span className="text-xs font-bold text-gray-900 dark:text-white">
                    OLM-{r.olmNumber}
                  </span>
                )}
                <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400">
                  {r.amazonOrderId}
                </span>
                <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium', STATUS_COLOR[r.workflowStatus] ?? 'bg-gray-100 text-gray-600')}>
                  {STATUS_LABEL[r.workflowStatus] ?? r.workflowStatus}
                </span>
              </div>
              {r.shipToName && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.shipToName}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {open && query.length >= 2 && results.length === 0 && !loading && (
        <div className="absolute z-[9999] mt-1 w-full min-w-[320px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl px-4 py-3">
          <p className="text-xs text-gray-500">No orders found</p>
        </div>
      )}
    </div>
  )
}
