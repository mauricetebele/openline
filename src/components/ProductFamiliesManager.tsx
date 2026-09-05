'use client'
import { useState, useEffect, useCallback, Fragment } from 'react'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import { Boxes, Plus, Search, X, Loader2, Trash2, Pencil, Filter, Tag, ChevronRight, ChevronDown } from 'lucide-react'
import type { ProductAttrs } from '@/lib/product-attributes'

interface Family { id: string; name: string; memberCount: number }
interface Member { id: string; sku: string; description: string; isSerializable?: boolean; attrs: ProductAttrs }
interface SearchResult { id: string; sku: string; description: string; familyId: string | null; familyName: string | null }
interface Listing {
  mskuId: string; marketplace: string; sellerSku: string; accountId: string | null
  price: number | null; cost: number | null; commissionPct: number | null; marginPct: number | null
}
interface GradeRow { gradeId: string | null; grade: string; readyForSale: number; listings: Listing[] }

const MKT_COLOR: Record<string, string> = {
  amazon: 'bg-orange-100 text-orange-700', backmarket: 'bg-blue-100 text-blue-700', wholesale: 'bg-purple-100 text-purple-700',
}

const ATTRS = [
  { key: 'storage', label: 'Storage' },
  { key: 'ram', label: 'RAM' },
  { key: 'cpu', label: 'CPU' },
  { key: 'gpu', label: 'GPU' },
  { key: 'color', label: 'Color' },
  { key: 'screen', label: 'Screen' },
] as const
type AttrKey = typeof ATTRS[number]['key']

const COL_COUNT = 4 + ATTRS.length // chevron, SKU, Title, ready, + attrs, (remove shares last)

/** Live net margin at a given price (null when cost/fees unknown or out of stock). */
function liveMargin(l: Listing, priceStr: string): number | null {
  if (l.cost == null || l.commissionPct == null) return null
  const price = parseFloat(priceStr)
  if (!(price > 0)) return null
  return Math.round(((price - (l.commissionPct / 100) * price - l.cost) / price) * 1000) / 10
}
function marginClass(m: number | null): string {
  if (m == null) return 'text-gray-400'
  if (m >= 12) return 'text-emerald-600 dark:text-emerald-400'
  if (m >= 0) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

export default function ProductFamiliesManager() {
  const [families, setFamilies] = useState<Family[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [family, setFamily] = useState<{ id: string; name: string; members: Member[] } | null>(null)
  const [loadingFamily, setLoadingFamily] = useState(false)
  const [filters, setFilters] = useState<Partial<Record<AttrKey, string>>>({})
  const [details, setDetails] = useState<Record<string, GradeRow[]>>({})
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({})
  const [pushing, setPushing] = useState<string | null>(null)

  // Add-SKUs modal
  const [showAdd, setShowAdd] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [addResults, setAddResults] = useState<SearchResult[]>([])
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  const loadFamilies = useCallback(async () => {
    try { const d = await (await fetch('/api/product-families')).json(); setFamilies(d.families ?? []) } catch { /* ignore */ }
  }, [])
  useEffect(() => { loadFamilies() }, [loadFamilies])

  const loadDetails = useCallback(async (id: string) => {
    setLoadingDetails(true)
    try {
      const d = await (await fetch(`/api/product-families/${id}/details`)).json()
      const map: Record<string, GradeRow[]> = {}
      for (const p of (d.products ?? [])) map[p.productId] = p.grades
      setDetails(map)
    } catch { /* ignore */ } finally { setLoadingDetails(false) }
  }, [])

  const openFamily = useCallback(async (id: string) => {
    setActiveId(id); setLoadingFamily(true); setFilters({}); setDetails({}); setPriceEdits({}); setCollapsed(new Set())
    loadDetails(id)
    try { const d = await (await fetch(`/api/product-families/${id}`)).json(); if (!d.error) setFamily(d) } catch { /* ignore */ }
    finally { setLoadingFamily(false) }
  }, [loadDetails])

  async function pushPrice(l: Listing) {
    const raw = priceEdits[l.mskuId] ?? (l.price != null ? String(l.price) : '')
    const price = parseFloat(raw)
    if (!(price > 0)) { toast.error('Enter a valid price'); return }
    setPushing(l.mskuId)
    try {
      let res: Response
      if (l.marketplace === 'backmarket') {
        res = await fetch('/api/marketplace-skus/backmarket-price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sellerSku: l.sellerSku, price }) })
      } else if (l.marketplace === 'amazon') {
        if (!l.accountId) throw new Error('No Amazon account linked to this listing')
        res = await fetch('/api/listings/update-price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: l.accountId, sku: l.sellerSku, price }) })
      } else { throw new Error('Wholesale prices are managed on the order') }
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Push failed')
      toast.success(`Pushed $${price.toFixed(2)} to ${l.marketplace}`)
      // Update the price in place; margin recomputes live from the new price.
      setDetails(prev => {
        const next: Record<string, GradeRow[]> = {}
        for (const [pid, grades] of Object.entries(prev)) {
          next[pid] = grades.map(g => ({ ...g, listings: g.listings.map(x => x.mskuId === l.mskuId ? { ...x, price } : x) }))
        }
        return next
      })
      setPriceEdits(e => { const n = { ...e }; delete n[l.mskuId]; return n })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Push failed') }
    finally { setPushing(null) }
  }

  async function createFamily() {
    const name = window.prompt('New family name (e.g. "MacBook Pro 16 M3")')
    if (!name || !name.trim()) return
    try {
      const res = await fetch('/api/product-families', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success(`Family "${d.family.name}" created`)
      await loadFamilies(); openFamily(d.family.id)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to create family') }
  }
  async function renameFamily() {
    if (!family) return
    const name = window.prompt('Rename family', family.name)
    if (!name || !name.trim() || name.trim() === family.name) return
    try {
      const res = await fetch(`/api/product-families/${family.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setFamily(f => f ? { ...f, name: d.name } : f); loadFamilies()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Rename failed') }
  }
  async function deleteFamily() {
    if (!family) return
    if (!window.confirm(`Delete family "${family.name}"? The SKUs stay, they're just ungrouped.`)) return
    await fetch(`/api/product-families/${family.id}`, { method: 'DELETE' })
    toast.success('Family deleted'); setFamily(null); setActiveId(null); loadFamilies()
  }
  async function removeMember(productId: string) {
    if (!family) return
    await fetch(`/api/product-families/${family.id}/members?productId=${productId}`, { method: 'DELETE' })
    setFamily(f => f ? { ...f, members: f.members.filter(m => m.id !== productId) } : f)
    loadFamilies()
  }

  // Add flow
  const runAddSearch = useCallback(async (q: string) => {
    try { const d = await (await fetch(`/api/product-families/search-products?q=${encodeURIComponent(q)}`)).json(); setAddResults(d.products ?? []) } catch { /* ignore */ }
  }, [])
  useEffect(() => { if (showAdd) { const t = setTimeout(() => runAddSearch(addSearch), 250); return () => clearTimeout(t) } }, [showAdd, addSearch, runAddSearch])

  async function addMembers() {
    if (!family || addSelected.size === 0) return
    setAdding(true)
    try {
      const res = await fetch(`/api/product-families/${family.id}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productIds: Array.from(addSelected) }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success(`Added ${d.added} SKU${d.added !== 1 ? 's' : ''}`)
      setShowAdd(false); setAddSelected(new Set()); setAddSearch('')
      openFamily(family.id); loadFamilies()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to add') }
    finally { setAdding(false) }
  }

  // Filtering
  const members = family?.members ?? []
  const optionsFor = (key: AttrKey) => Array.from(new Set(members.map(m => m.attrs[key]).filter(Boolean) as string[])).sort()
  const visible = members.filter(m => (Object.entries(filters) as [AttrKey, string][]).every(([k, v]) => !v || m.attrs[k] === v))
  const toggle = (id: string) => setCollapsed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const totalReady = (pid: string) => (details[pid] ?? []).reduce((s, g) => s + g.readyForSale, 0)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Families sidebar */}
      <div className="w-60 shrink-0 border-r dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-900/50">
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
          <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5"><Boxes size={16} className="text-amazon-blue" /> Families</h1>
          <button onClick={createFamily} title="New family" className="text-amazon-blue hover:text-blue-700"><Plus size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {families.length === 0 ? (
            <p className="px-4 py-6 text-xs text-gray-400 text-center">No families yet. Create one to group SKUs.</p>
          ) : families.map(f => (
            <button key={f.id} onClick={() => openFamily(f.id)} className={clsx('w-full flex items-center justify-between px-4 py-2 text-sm', activeId === f.id ? 'bg-amazon-blue/10 text-amazon-blue font-semibold' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5')}>
              <span className="truncate">{f.name}</span>
              <span className="text-[10px] font-bold text-gray-400 shrink-0 ml-2">{f.memberCount}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Family view */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!family ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
            <Boxes size={40} className="text-gray-200 dark:text-gray-600" />
            <p className="text-sm text-gray-400">Select a family, or create one to group SKUs by configuration.</p>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  {family.name}
                  <button onClick={renameFamily} title="Rename" className="text-gray-300 hover:text-gray-600 dark:hover:text-gray-200"><Pencil size={13} /></button>
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{members.length} SKU{members.length !== 1 ? 's' : ''}{visible.length !== members.length ? ` · ${visible.length} shown` : ''}{loadingDetails ? ' · loading prices…' : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={deleteFamily} title="Delete family" className="text-gray-400 hover:text-red-500 p-1.5"><Trash2 size={15} /></button>
                <button onClick={() => { setShowAdd(true); setAddResults([]); setAddSearch('') }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700"><Plus size={15} /> Add SKUs</button>
              </div>
            </div>

            {/* Attribute filters */}
            <div className="px-6 py-2.5 border-b dark:border-gray-700 shrink-0 flex flex-wrap items-center gap-2 bg-gray-50 dark:bg-gray-900/40">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 inline-flex items-center gap-1"><Filter size={11} /> Filter</span>
              {ATTRS.map(a => {
                const opts = optionsFor(a.key)
                if (opts.length === 0) return null
                return (
                  <select key={a.key} value={filters[a.key] ?? ''} onChange={e => setFilters(f => ({ ...f, [a.key]: e.target.value }))}
                    className={clsx('h-8 rounded-md border px-2 text-xs', filters[a.key] ? 'border-amazon-blue text-amazon-blue font-semibold' : 'border-gray-300 dark:border-white/15 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800')}>
                    <option value="">{a.label}: All</option>
                    {opts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )
              })}
              {Object.values(filters).some(Boolean) && <button onClick={() => setFilters({})} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Clear</button>}
            </div>

            <div className="flex-1 overflow-auto">
              {loadingFamily ? (
                <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
              ) : members.length === 0 ? (
                <div className="py-20 text-center text-sm text-gray-400">No SKUs in this family yet. Click <span className="font-medium">Add SKUs</span>.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-800 z-10">
                    <tr>
                      <th className="px-2 py-2.5 w-6"></th>
                      <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">SKU</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-gray-100">Title</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Ready</th>
                      {ATTRS.map(a => <th key={a.key} className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">{a.label}</th>)}
                      <th className="px-3 py-2.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {visible.map((m, i) => {
                      const grades = details[m.id] ?? []
                      const isOpen = !collapsed.has(m.id)
                      const ready = totalReady(m.id)
                      const listingCount = grades.reduce((s, g) => s + g.listings.length, 0)
                      return (
                        <Fragment key={m.id}>
                          <tr onClick={() => toggle(m.id)} className={clsx('cursor-pointer', i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50', 'hover:bg-amazon-blue/5')}>
                            <td className="px-2 py-2 text-gray-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-amazon-blue whitespace-nowrap">{m.sku}</td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[340px] truncate" title={m.description}>{m.description}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <span className={clsx('font-semibold', ready > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-300 dark:text-gray-600')}>{ready}</span>
                              {listingCount > 0 && <span className="ml-1.5 text-[10px] text-gray-400">{listingCount} list.</span>}
                            </td>
                            {ATTRS.map(a => (
                              <td key={a.key} className="px-3 py-2 whitespace-nowrap">
                                {m.attrs[a.key] ? <span className="text-gray-800 dark:text-gray-200">{m.attrs[a.key]}</span> : <span className="text-gray-300 dark:text-gray-600">—</span>}
                              </td>
                            ))}
                            <td className="px-3 py-2">
                              <button onClick={e => { e.stopPropagation(); removeMember(m.id) }} title="Remove from family" className="text-gray-300 hover:text-red-500"><X size={13} /></button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-gray-50/70 dark:bg-gray-800/30">
                              <td className="p-0" colSpan={COL_COUNT + 1}>
                                <div className="pl-9 pr-4 py-2 space-y-2">
                                  {grades.length === 0 ? (
                                    <p className="text-[11px] text-gray-400 py-1">{loadingDetails ? 'Loading marketplace listings…' : 'No marketplace listings or stock for this SKU.'}</p>
                                  ) : grades.map(g => (
                                    <div key={g.gradeId ?? 'none'} className="rounded-md border border-gray-200 dark:border-white/10 overflow-hidden bg-white dark:bg-gray-900">
                                      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                                        <span className="inline-flex px-1.5 py-0.5 rounded bg-gray-800 dark:bg-gray-700 text-white text-[10px] font-bold whitespace-nowrap">{g.gradeId ? `Grade ${g.grade}` : g.grade}</span>
                                        <span className="text-[11px] text-gray-500 dark:text-gray-400">Ready for Sale: <b className={g.readyForSale > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}>{g.readyForSale}</b></span>
                                      </div>
                                      {g.listings.length === 0 ? (
                                        <div className="px-3 py-2 text-[11px] text-gray-400">No marketplace listings for this grade.</div>
                                      ) : (
                                        <table className="w-full text-[11px]">
                                          <thead>
                                            <tr className="text-gray-400 dark:text-gray-500">
                                              <th className="px-3 py-1.5 text-left font-medium">Marketplace</th>
                                              <th className="px-3 py-1.5 text-left font-medium">Seller SKU</th>
                                              <th className="px-3 py-1.5 text-right font-medium">Price</th>
                                              <th className="px-3 py-1.5 text-right font-medium">Margin</th>
                                              <th className="px-3 py-1.5 w-16"></th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                            {g.listings.map(l => {
                                              const editable = l.marketplace === 'amazon' || l.marketplace === 'backmarket'
                                              const val = priceEdits[l.mskuId] ?? (l.price != null ? String(l.price) : '')
                                              const changed = editable && val !== '' && parseFloat(val) !== (l.price ?? NaN)
                                              const margin = val !== '' ? liveMargin(l, val) : l.marginPct
                                              return (
                                                <tr key={l.mskuId} className="text-gray-700 dark:text-gray-300">
                                                  <td className="px-3 py-1.5"><span className={clsx('inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold capitalize', MKT_COLOR[l.marketplace] ?? 'bg-gray-100 text-gray-600')}>{l.marketplace}</span></td>
                                                  <td className="px-3 py-1.5 font-mono text-gray-500 dark:text-gray-400 whitespace-nowrap">{l.sellerSku}</td>
                                                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                                    {editable ? (
                                                      <div className="inline-flex items-center gap-1">
                                                        <span className="text-gray-400">$</span>
                                                        <input type="number" step="0.01" min="0" value={val}
                                                          onChange={e => setPriceEdits(s => ({ ...s, [l.mskuId]: e.target.value }))}
                                                          onKeyDown={e => { if (e.key === 'Enter') pushPrice(l) }}
                                                          className="w-24 h-7 rounded border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2 text-right text-[11px] text-gray-900 dark:text-white" />
                                                      </div>
                                                    ) : <span className="text-gray-400">{l.price != null ? `$${l.price.toFixed(2)}` : '—'}</span>}
                                                  </td>
                                                  <td className={clsx('px-3 py-1.5 text-right font-semibold whitespace-nowrap tabular-nums', marginClass(margin))}>
                                                    {margin != null ? `${margin.toFixed(1)}%` : '—'}
                                                  </td>
                                                  <td className="px-3 py-1.5 text-right">
                                                    {editable && (
                                                      <button onClick={() => pushPrice(l)} disabled={pushing === l.mskuId || !val}
                                                        className={clsx('inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-semibold disabled:opacity-40',
                                                          changed ? 'bg-amazon-blue text-white hover:bg-blue-700' : 'border border-gray-300 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5')}>
                                                        {pushing === l.mskuId ? <Loader2 size={10} className="animate-spin" /> : <Tag size={10} />} Push
                                                      </button>
                                                    )}
                                                  </td>
                                                </tr>
                                              )
                                            })}
                                          </tbody>
                                        </table>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* Add SKUs modal */}
      {showAdd && family && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Add SKUs to {family.name}</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white"><X size={16} /></button>
            </div>
            <div className="px-5 py-3 border-b dark:border-gray-700">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input autoFocus value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="Search by SKU or title…"
                  className="w-full h-9 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 pl-8 pr-2.5 text-sm text-gray-900 dark:text-white" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {addResults.length === 0 ? (
                <p className="py-10 text-center text-xs text-gray-400">Search for products to add.</p>
              ) : addResults.map(p => {
                const inThis = p.familyId === family.id
                const inOther = p.familyId && p.familyId !== family.id
                const sel = addSelected.has(p.id)
                return (
                  <button key={p.id} disabled={inThis} onClick={() => setAddSelected(s => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}
                    className={clsx('w-full flex items-center gap-2 px-4 py-2 text-left border-b dark:border-gray-800', inThis ? 'opacity-50 cursor-default' : sel ? 'bg-amazon-blue/10' : 'hover:bg-gray-50 dark:hover:bg-white/5')}>
                    <input type="checkbox" checked={sel || inThis} readOnly disabled={inThis} className="rounded border-gray-300 text-amazon-blue" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-mono font-semibold text-gray-800 dark:text-gray-200">{p.sku}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{p.description}</div>
                    </div>
                    {inThis && <span className="text-[10px] text-gray-400 shrink-0">in this family</span>}
                    {inOther && <span className="text-[10px] text-amber-600 shrink-0" title={`Currently in ${p.familyName}`}>in {p.familyName}</span>}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t dark:border-gray-700">
              <span className="text-xs text-gray-500">{addSelected.size} selected</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowAdd(false)} className="h-9 px-4 rounded-md border border-gray-300 dark:border-white/15 text-sm text-gray-600 dark:text-gray-300">Cancel</button>
                <button onClick={addMembers} disabled={adding || addSelected.size === 0} className="inline-flex items-center gap-1.5 h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
                  {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add {addSelected.size > 0 ? addSelected.size : ''}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
