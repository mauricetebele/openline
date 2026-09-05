'use client'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import { Boxes, Plus, Search, X, Loader2, Trash2, Pencil, Filter, Tag } from 'lucide-react'
import type { ProductAttrs } from '@/lib/product-attributes'

interface Family { id: string; name: string; memberCount: number }
interface Member { id: string; sku: string; description: string; isSerializable?: boolean; attrs: ProductAttrs }
interface SearchResult { id: string; sku: string; description: string; familyId: string | null; familyName: string | null }
interface PriceRow {
  mskuId: string; productId: string; productSku: string; description: string
  marketplace: string; grade: string | null; sellerSku: string; accountId: string | null
  asin: string | null; price: number | null; minPrice: number | null; maxPrice: number | null; listingStatus: string | null
}

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

export default function ProductFamiliesManager() {
  const [families, setFamilies] = useState<Family[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [family, setFamily] = useState<{ id: string; name: string; members: Member[] } | null>(null)
  const [loadingFamily, setLoadingFamily] = useState(false)
  const [filters, setFilters] = useState<Partial<Record<AttrKey, string>>>({})
  const [view, setView] = useState<'attributes' | 'pricing'>('attributes')
  const [pricing, setPricing] = useState<PriceRow[]>([])
  const [loadingPricing, setLoadingPricing] = useState(false)
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

  const openFamily = useCallback(async (id: string) => {
    setActiveId(id); setLoadingFamily(true); setFilters({}); setView('attributes'); setPricing([]); setPriceEdits({})
    try { const d = await (await fetch(`/api/product-families/${id}`)).json(); if (!d.error) setFamily(d) } catch { /* ignore */ }
    finally { setLoadingFamily(false) }
  }, [])

  const loadPricing = useCallback(async (id: string) => {
    setLoadingPricing(true); setPriceEdits({})
    try { const d = await (await fetch(`/api/product-families/${id}/pricing`)).json(); setPricing(d.rows ?? []) } catch { /* ignore */ }
    finally { setLoadingPricing(false) }
  }, [])
  useEffect(() => { if (view === 'pricing' && activeId) loadPricing(activeId) }, [view, activeId, loadPricing])

  async function pushPrice(row: PriceRow) {
    const raw = priceEdits[row.mskuId] ?? (row.price != null ? String(row.price) : '')
    const price = parseFloat(raw)
    if (!(price > 0)) { toast.error('Enter a valid price'); return }
    setPushing(row.mskuId)
    try {
      let res: Response
      if (row.marketplace === 'backmarket') {
        res = await fetch('/api/marketplace-skus/backmarket-price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sellerSku: row.sellerSku, price }) })
      } else if (row.marketplace === 'amazon') {
        if (!row.accountId) throw new Error('No Amazon account linked to this listing')
        res = await fetch('/api/listings/update-price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: row.accountId, sku: row.sellerSku, price }) })
      } else { throw new Error('Wholesale prices are managed on the order') }
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Push failed')
      toast.success(`Pushed $${price.toFixed(2)} to ${row.marketplace}`)
      setPricing(prev => prev.map(r => r.mskuId === row.mskuId ? { ...r, price } : r))
      setPriceEdits(e => { const n = { ...e }; delete n[row.mskuId]; return n })
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
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{members.length} SKU{members.length !== 1 ? 's' : ''}{visible.length !== members.length ? ` · ${visible.length} shown` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-md border border-gray-300 dark:border-white/15 overflow-hidden text-xs font-medium">
                  {(['attributes', 'pricing'] as const).map(v => (
                    <button key={v} onClick={() => setView(v)} className={clsx('px-3 h-9 capitalize', view === v ? 'bg-amazon-blue text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5')}>{v}</button>
                  ))}
                </div>
                <button onClick={deleteFamily} title="Delete family" className="text-gray-400 hover:text-red-500 p-1.5"><Trash2 size={15} /></button>
                <button onClick={() => { setShowAdd(true); setAddResults([]); setAddSearch('') }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700"><Plus size={15} /> Add SKUs</button>
              </div>
            </div>

            {/* Attribute filters */}
            {view === 'attributes' && (
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
            )}

            <div className="flex-1 overflow-auto">
              {view === 'attributes' ? (
                loadingFamily ? (
                  <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
                ) : members.length === 0 ? (
                  <div className="py-20 text-center text-sm text-gray-400">No SKUs in this family yet. Click <span className="font-medium">Add SKUs</span>.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-800 z-10">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">SKU</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-100">Title</th>
                        {ATTRS.map(a => <th key={a.key} className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">{a.label}</th>)}
                        <th className="px-3 py-2.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {visible.map((m, i) => (
                        <tr key={m.id} className={i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'}>
                          <td className="px-3 py-2 font-mono font-semibold text-amazon-blue whitespace-nowrap">{m.sku}</td>
                          <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[360px] truncate" title={m.description}>{m.description}</td>
                          {ATTRS.map(a => (
                            <td key={a.key} className="px-3 py-2 whitespace-nowrap">
                              {m.attrs[a.key] ? <span className="text-gray-800 dark:text-gray-200">{m.attrs[a.key]}</span> : <span className="text-gray-300 dark:text-gray-600">—</span>}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            <button onClick={() => removeMember(m.id)} title="Remove from family" className="text-gray-300 hover:text-red-500"><X size={13} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : (
                // ── Pricing view ──
                loadingPricing ? (
                  <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading prices…</div>
                ) : pricing.length === 0 ? (
                  <div className="py-20 text-center text-sm text-gray-400">No marketplace listings for this family&apos;s SKUs.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-800 z-10">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">SKU</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-100">Title</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Marketplace</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Grade</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Seller SKU</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Price</th>
                        <th className="px-3 py-2.5 w-20"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {pricing.map((r, i) => {
                        const editable = r.marketplace === 'amazon' || r.marketplace === 'backmarket'
                        const val = priceEdits[r.mskuId] ?? (r.price != null ? String(r.price) : '')
                        const changed = editable && val !== '' && parseFloat(val) !== (r.price ?? NaN)
                        return (
                          <tr key={r.mskuId} className={i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'}>
                            <td className="px-3 py-2 font-mono font-semibold text-amazon-blue whitespace-nowrap">{r.productSku}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400 max-w-[260px] truncate" title={r.description}>{r.description}</td>
                            <td className="px-3 py-2"><span className={clsx('inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold capitalize', MKT_COLOR[r.marketplace] ?? 'bg-gray-100 text-gray-600')}>{r.marketplace}</span></td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.grade ?? '—'}</td>
                            <td className="px-3 py-2 font-mono text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.sellerSku}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              {editable ? (
                                <div className="inline-flex items-center gap-1">
                                  <span className="text-gray-400">$</span>
                                  <input type="number" step="0.01" min="0" value={val}
                                    onChange={e => setPriceEdits(s => ({ ...s, [r.mskuId]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') pushPrice(r) }}
                                    className="w-24 h-7 rounded border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2 text-right text-xs text-gray-900 dark:text-white" />
                                </div>
                              ) : <span className="text-gray-400">{r.price != null ? `$${r.price.toFixed(2)}` : '—'}</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {editable && (
                                <button onClick={() => pushPrice(r)} disabled={pushing === r.mskuId || !val}
                                  className={clsx('inline-flex items-center gap-1 h-7 px-2.5 rounded text-[11px] font-semibold disabled:opacity-40',
                                    changed ? 'bg-amazon-blue text-white hover:bg-blue-700' : 'border border-gray-300 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5')}>
                                  {pushing === r.mskuId ? <Loader2 size={11} className="animate-spin" /> : <Tag size={11} />} Push
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
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
