'use client'
import { useState, useRef, useEffect } from 'react'
import { Package, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { useRouter } from 'next/navigation'

interface Result {
  productId: string
  sku: string
  description: string
  grade: string | null
  warehouseName: string
  locationName: string
  onHand: number
  qty: number
  reserved: number
}

export default function InventoryQuickSearch({ mobile }: { mobile?: boolean }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) { setResults([]); setOpen(false); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/inventory?search=${encodeURIComponent(query.trim())}`)
        const data = await res.json()
        const items = (data.data ?? []).slice(0, 8).map((item: Record<string, unknown>) => {
          const product = item.product as { id: string; sku: string; description: string }
          const grade = item.grade as { grade: string } | null
          const location = item.location as { name: string; warehouse: { name: string } }
          return {
            productId: product.id,
            sku: product.sku,
            description: product.description,
            grade: grade?.grade ?? null,
            warehouseName: location.warehouse.name,
            locationName: location.name,
            onHand: item.onHand as number,
            qty: item.qty as number,
            reserved: item.reserved as number,
          }
        })
        setResults(items)
        setOpen(items.length > 0)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleSelect(r: Result) {
    setOpen(false)
    setQuery('')
    router.push(`/inventory?search=${encodeURIComponent(r.sku)}`)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && query.trim()) {
      e.preventDefault()
      setOpen(false)
      setQuery('')
      router.push(`/inventory?search=${encodeURIComponent(query.trim())}`)
    }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={wrapperRef} className={clsx('relative', mobile ? 'w-full' : 'w-56')}>
      <div className={clsx(
        'flex items-center gap-2 rounded-md border transition-colors',
        mobile
          ? 'bg-gray-800 border-white/10 px-3 py-2'
          : 'bg-white/10 border-transparent hover:border-white/20 focus-within:border-white/30 px-2.5 py-1.5',
      )}>
        <Package size={14} className="text-gray-400 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setOpen(true) }}
          placeholder="Inventory search"
          className="bg-transparent text-sm text-white placeholder:text-gray-500 outline-none w-full"
        />
        {loading && <Search size={12} className="text-gray-500 animate-pulse shrink-0" />}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 max-h-80 overflow-auto z-50">
          {results.map((r, i) => (
            <button
              key={`${r.productId}-${r.grade}-${r.locationName}-${i}`}
              type="button"
              onClick={() => handleSelect(r)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-800 font-mono">{r.sku}</span>
                <span className="text-[10px] text-gray-400">{r.warehouseName} / {r.locationName}</span>
              </div>
              <div className="text-[11px] text-gray-500 truncate">{r.description}</div>
              <div className="flex items-center gap-3 mt-0.5">
                {r.grade && <span className="text-[10px] text-gray-400">{r.grade}</span>}
                <span className="text-[10px] font-medium text-green-600">On Hand: {r.onHand}</span>
                <span className="text-[10px] text-gray-400">Avail: {r.qty}</span>
                {r.reserved > 0 && <span className="text-[10px] text-yellow-600">Rsrvd: {r.reserved}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
