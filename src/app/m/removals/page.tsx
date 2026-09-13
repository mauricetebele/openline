'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Search, Loader2, ChevronRight, Camera, ImageIcon } from 'lucide-react'

interface CaseImage { url: string; filename: string; contentType: string; size: number }
interface RemovalCase {
  id: string
  caseNumber: number
  removalOrderId: string | null
  trackingNumber: string | null
  sellerSku: string | null
  fnsku: string | null
  productTitle: string | null
  status: string
  images: CaseImage[] | unknown
  createdAt: string
}

const STATUS_LABEL: Record<string, string> = {
  CASE_NOT_CREATED: 'Not Created',
  CASE_CREATED: 'Case Created',
  REIMBURSEMENT_DENIED: 'Denied',
  RESOLVED_REIMBURSED: 'Reimbursed',
}
const STATUS_COLOR: Record<string, string> = {
  CASE_NOT_CREATED: 'bg-gray-100 text-gray-600',
  CASE_CREATED: 'bg-blue-100 text-blue-700',
  REIMBURSEMENT_DENIED: 'bg-red-100 text-red-700',
  RESOLVED_REIMBURSED: 'bg-emerald-100 text-emerald-700',
}

function imageCount(images: RemovalCase['images']): number {
  return Array.isArray(images) ? images.length : 0
}

export default function MobileRemovalsList() {
  const [search, setSearch] = useState('')
  const [cases, setCases] = useState<RemovalCase[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ pageSize: '50' })
      if (q) params.set('search', q)
      const res = await fetch(`/api/removal-cases?${params}`)
      const d = await res.json()
      setCases(res.ok ? (d.data ?? []) : [])
    } catch { setCases([]) } finally { setLoading(false) }
  }, [])

  useEffect(() => { const t = setTimeout(() => load(search), 250); return () => clearTimeout(t) }, [search, load])

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <header className="sticky top-0 z-10 bg-amazon-blue text-white px-4 pt-[env(safe-area-inset-top)]">
        <div className="py-3">
          <h1 className="text-base font-bold flex items-center gap-2"><Camera size={18} /> Removal Photos</h1>
          <p className="text-[11px] text-white/70 mt-0.5">Pick a removal case, then take photos.</p>
        </div>
        <div className="relative pb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            inputMode="search"
            placeholder="Search case #, tracking, SKU, LPN…"
            className="w-full h-11 rounded-xl border-0 pl-9 pr-3 text-[15px] text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-white/60"
          />
        </div>
      </header>

      <main className="flex-1 p-3">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : cases.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">{search ? 'No matching cases' : 'No removal cases'}</div>
        ) : (
          <ul className="space-y-2">
            {cases.map(c => {
              const n = imageCount(c.images)
              return (
                <li key={c.id}>
                  <Link href={`/m/removals/${c.id}`} className="flex items-center gap-3 bg-white rounded-xl p-3 shadow-sm active:bg-gray-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-amazon-blue">REMOVALCASE-{c.caseNumber}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_COLOR[c.status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[c.status] ?? c.status}</span>
                      </div>
                      <div className="text-[13px] text-gray-800 font-medium truncate mt-0.5">{c.sellerSku ?? '—'}</div>
                      {c.productTitle && <div className="text-[11px] text-gray-500 truncate">{c.productTitle}</div>}
                      <div className="text-[11px] text-gray-400 truncate mt-0.5">{c.trackingNumber ?? 'No tracking'}</div>
                    </div>
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${n > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                        <ImageIcon size={13} /> {n}
                      </span>
                      <ChevronRight size={18} className="text-gray-300" />
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
