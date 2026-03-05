'use client'
import { useState, useRef, useEffect } from 'react'
import { Search, Download, AlertCircle, X, Pencil, Check, NotebookPen, MapPin } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SerialResult {
  id: string
  serialNumber: string
  status: string
  sku: string
  description: string
  vendor: string | null
  lastEventType: string | null
  lastEventDate: string | null
  lastMovementType: string | null
  lastMovementDate: string | null
  location: string | null
  locationId: string | null
  warehouseId: string | null
  binLocation: string | null
  poNumber: string | null
  cost: number | null
  note: string | null
}

interface WarehouseWithLocations {
  id: string
  name: string
  locations: { id: string; name: string }[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtEventType(e: string | null) {
  if (!e) return '—'
  return e.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const STATUS_COLOR: Record<string, string> = {
  IN_STOCK:  'bg-green-100 text-green-700',
  SOLD:      'bg-blue-100 text-blue-700',
  RETURNED:  'bg-yellow-100 text-yellow-700',
  DAMAGED:   'bg-red-100 text-red-600',
}

function parseSNs(raw: string) {
  return raw
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i)
}

function exportCSV(found: SerialResult[], notFound: string[]) {
  const headers = ['Serial #', 'Status', 'SKU', 'Description', 'Vendor', 'Last Event Type', 'Date of Last Event', 'Last Movement', 'Date of Last Movement', 'Current Location', 'Bin', 'PO #', 'Cost', 'Note']
  const rows = found.map(r => [
    r.serialNumber,
    r.status.replace('_', ' '),
    r.sku,
    r.description,
    r.vendor ?? '',
    fmtEventType(r.lastEventType),
    fmtDate(r.lastEventDate),
    fmtEventType(r.lastMovementType),
    fmtDate(r.lastMovementDate),
    r.location ?? '',
    r.binLocation ?? '',
    r.poNumber ?? '',
    r.cost != null ? r.cost.toFixed(2) : '',
    r.note ?? '',
  ])
  notFound.forEach(sn => rows.push([sn, 'NOT FOUND', '', '', '', '', '', '', '', '', '', '', '', '']))

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `serial-search-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SerialSearchManager() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [found, setFound] = useState<SerialResult[]>([])
  const [notFound, setNotFound] = useState<string[]>([])
  const [searched, setSearched] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Location filter state
  const [warehouses, setWarehouses] = useState<WarehouseWithLocations[]>([])
  const [filterWarehouseId, setFilterWarehouseId] = useState<string>('')
  const [filterLocationId, setFilterLocationId] = useState<string>('')
  const [filterPo, setFilterPo] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('')

  // Fetch warehouses for the location filter
  useEffect(() => {
    fetch('/api/warehouses')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data) setWarehouses(d.data) })
      .catch(() => {})
  }, [])

  // Inline note editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const cancelNoteRef = useRef(false)

  // Checkbox selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Bulk note state
  const [bulkNote, setBulkNote] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  // Bulk bin location state
  const [bulkBin, setBulkBin] = useState('')
  const [bulkBinSaving, setBulkBinSaving] = useState(false)

  // Sort state
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const count = parseSNs(input).length
  const allSelected = found.length > 0 && found.every(r => selectedIds.has(r.id))
  const someSelected = selectedIds.size > 0

  function toggleRow(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(found.map(r => r.id)))
    }
  }

  async function handleSearch() {
    const sns = parseSNs(input)
    const hasFilter = filterWarehouseId || filterLocationId || filterPo.trim() || filterStatus
    if (!sns.length && !hasFilter) return
    setLoading(true)
    setErr(null)
    setSearched(false)
    setEditingId(null)
    setSelectedIds(new Set())
    setBulkNote('')
    setBulkBin('')
    try {
      const params = new URLSearchParams()
      if (sns.length) params.set('serials', sns.join(','))
      if (filterLocationId) params.set('locationId', filterLocationId)
      else if (filterWarehouseId) params.set('warehouseId', filterWarehouseId)
      if (filterPo.trim()) params.set('poNumber', filterPo.trim())
      if (filterStatus) params.set('status', filterStatus)
      const res = await fetch(`/api/serial-search?${params}`)
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Search failed'); return }
      setFound(data.found)
      setNotFound(data.notFound ?? [])
      setSearched(true)
    } catch {
      setErr('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  function handleClear() {
    setInput('')
    setFound([])
    setNotFound([])
    setSearched(false)
    setErr(null)
    setEditingId(null)
    setSelectedIds(new Set())
    setBulkNote('')
    setBulkBin('')
    setFilterWarehouseId('')
    setFilterLocationId('')
    setFilterPo('')
    setFilterStatus('')
    textareaRef.current?.focus()
  }

  function startEdit(r: SerialResult) {
    setEditingId(r.id)
    setEditingNote(r.note ?? '')
  }

  async function saveNote(id: string) {
    if (cancelNoteRef.current) { cancelNoteRef.current = false; return }
    setSavingId(id)
    try {
      const res = await fetch('/api/serial-search/note', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, note: editingNote }),
      })
      if (res.ok) {
        const saved = editingNote.trim() || null
        setFound(prev => prev.map(r => r.id === id ? { ...r, note: saved } : r))
      }
    } catch { /* ignore */ }
    finally {
      setSavingId(null)
      setEditingId(null)
    }
  }

  function handleNoteKeyDown(e: React.KeyboardEvent, id: string) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(id) }
    if (e.key === 'Escape') { cancelNoteRef.current = true; setEditingId(null) }
  }

  async function applyBulkNote() {
    if (selectedIds.size === 0) return
    setBulkSaving(true)
    const note = bulkNote.trim() || null
    const ids = Array.from(selectedIds)
    try {
      await Promise.all(ids.map(id =>
        fetch('/api/serial-search/note', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, note }),
        })
      ))
      setFound(prev => prev.map(r => selectedIds.has(r.id) ? { ...r, note } : r))
      setSelectedIds(new Set())
      setBulkNote('')
    } catch { /* ignore */ }
    finally { setBulkSaving(false) }
  }

  // Count how many selected serials are IN_STOCK
  const selectedInStock = found.filter(r => selectedIds.has(r.id) && r.status === 'IN_STOCK')

  async function applyBulkBin() {
    if (selectedInStock.length === 0) return
    setBulkBinSaving(true)
    try {
      const res = await fetch('/api/serials/bin-location', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialIds: selectedInStock.map(r => r.id), binLocation: bulkBin }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to update')
      const newBin = bulkBin.trim() || null
      const updatedIds = new Set(selectedInStock.map(r => r.id))
      setFound(prev => prev.map(r => updatedIds.has(r.id) ? { ...r, binLocation: newBin } : r))
      setSelectedIds(new Set())
      setBulkBin('')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to update bin location')
    } finally {
      setBulkBinSaving(false)
    }
  }

  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const sortedFound = sortCol === null ? found : [...found].sort((a, b) => {
    let av: string | number | null = null
    let bv: string | number | null = null
    if (sortCol === 'serialNumber')   { av = a.serialNumber;   bv = b.serialNumber }
    if (sortCol === 'status')         { av = a.status;         bv = b.status }
    if (sortCol === 'sku')            { av = a.sku;            bv = b.sku }
    if (sortCol === 'vendor')         { av = a.vendor;         bv = b.vendor }
    if (sortCol === 'lastEventType')    { av = a.lastEventType;    bv = b.lastEventType }
    if (sortCol === 'lastEventDate')   { av = a.lastEventDate;   bv = b.lastEventDate }
    if (sortCol === 'lastMovementType') { av = a.lastMovementType; bv = b.lastMovementType }
    if (sortCol === 'lastMovementDate') { av = a.lastMovementDate; bv = b.lastMovementDate }
    if (sortCol === 'location')        { av = a.location;        bv = b.location }
    if (sortCol === 'binLocation')    { av = a.binLocation;    bv = b.binLocation }
    if (sortCol === 'poNumber')       { av = a.poNumber;       bv = b.poNumber }
    if (sortCol === 'cost')           { av = a.cost ?? -Infinity; bv = b.cost ?? -Infinity }
    if (sortCol === 'note')           { av = a.note;           bv = b.note }
    // Nulls to bottom
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  })

  const hasResults = searched && (found.length > 0 || notFound.length > 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white shrink-0">
        <h1 className="text-xl font-semibold text-gray-900">Serial # Search</h1>
        <p className="text-sm text-gray-500 mt-0.5">Look up multiple serial numbers at once — paste from a spreadsheet or scan one per line</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-5 space-y-5">

          {/* Input area */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">
                Serial Numbers
                <span className="text-gray-400 font-normal ml-2">one per line, or comma-separated</span>
              </label>
              {input && (
                <button onClick={handleClear} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                  <X size={12} /> Clear
                </button>
              )}
            </div>
            <textarea
              ref={textareaRef}
              rows={6}
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
              placeholder={'SN001\nSN002\nSN003'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  handleSearch()
                }
              }}
            />
            {/* Filters — alternative search methods */}
            <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
              <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Or filter by:</span>
              <select
                className="input w-40 text-xs"
                value={filterWarehouseId}
                onChange={e => { setFilterWarehouseId(e.target.value); setFilterLocationId('') }}
              >
                <option value="">Warehouse…</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              <select
                className="input w-40 text-xs"
                value={filterLocationId}
                onChange={e => setFilterLocationId(e.target.value)}
                disabled={!filterWarehouseId}
              >
                <option value="">All Locations</option>
                {(warehouses.find(w => w.id === filterWarehouseId)?.locations ?? []).map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <input
                type="text"
                className="input w-32 text-xs"
                placeholder="PO #"
                value={filterPo}
                onChange={e => setFilterPo(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
              />
              <select
                className="input w-36 text-xs"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
              >
                <option value="">All Statuses</option>
                <option value="IN_STOCK">In Stock</option>
                <option value="SOLD">Sold</option>
                <option value="RETURNED">Returned</option>
                <option value="DAMAGED">Damaged</option>
              </select>
              {(filterWarehouseId || filterLocationId || filterPo || filterStatus) && (
                <button
                  onClick={() => { setFilterWarehouseId(''); setFilterLocationId(''); setFilterPo(''); setFilterStatus('') }}
                  className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                >
                  <X size={12} /> Clear filters
                </button>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {count > 0 ? `${count} serial${count !== 1 ? 's' : ''} detected` : ((filterWarehouseId || filterPo || filterStatus) ? 'Filters set — hit Search' : 'Paste serial numbers above or use filters')}
                {count > 0 && <span className="ml-2 text-gray-300">·</span>}
                {count > 0 && <span className="ml-2">⌘+Enter to search</span>}
              </span>
              <div className="flex gap-2">
                {hasResults && (
                  <button
                    onClick={() => exportCSV(found, notFound)}
                    className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                  >
                    <Download size={13} /> Export CSV
                  </button>
                )}
                <button
                  onClick={handleSearch}
                  disabled={(count === 0 && !filterWarehouseId && !filterPo.trim() && !filterStatus) || loading}
                  className="flex items-center gap-2 bg-amazon-blue text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  <Search size={14} />
                  {loading ? 'Searching…' : `Search${count > 0 ? ` (${count})` : ''}`}
                </button>
              </div>
            </div>
          </div>

          {/* Error */}
          {err && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span className="flex-1">{err}</span>
              <button onClick={() => setErr(null)} className="text-red-400 hover:text-red-600">✕</button>
            </div>
          )}

          {/* Summary row */}
          {searched && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-600">
                <span className="font-semibold text-gray-900">{found.length}</span> found
              </span>
              {notFound.length > 0 && (
                <span className="text-red-600">
                  <span className="font-semibold">{notFound.length}</span> not found
                </span>
              )}
            </div>
          )}

          {/* Not-found chips */}
          {notFound.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Not Found in Inventory</p>
              <div className="flex flex-wrap gap-1.5">
                {notFound.map(sn => (
                  <span key={sn} className="inline-block font-mono text-xs bg-white border border-red-200 text-red-700 rounded px-2 py-0.5">
                    {sn}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Bulk actions bar — shown when rows are selected */}
          {someSelected && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-700">
                  {selectedIds.size} selected
                  {selectedInStock.length > 0 && selectedInStock.length < selectedIds.size && (
                    <span className="font-normal text-indigo-500 ml-1">({selectedInStock.length} in stock)</span>
                  )}
                </span>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-indigo-400 hover:text-indigo-600"
                  title="Clear selection"
                >
                  <X size={14} />
                </button>
              </div>
              {/* Bulk note */}
              <div className="flex items-center gap-2">
                <NotebookPen size={13} className="text-indigo-400 shrink-0" />
                <input
                  type="text"
                  value={bulkNote}
                  onChange={e => setBulkNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') applyBulkNote() }}
                  placeholder="Note for all selected…"
                  className="flex-1 text-xs border border-indigo-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                />
                <button
                  onClick={applyBulkNote}
                  disabled={bulkSaving}
                  className="flex items-center gap-1.5 text-xs font-medium bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <Check size={12} />
                  {bulkSaving ? 'Saving…' : 'Apply Note'}
                </button>
              </div>
              {/* Bulk bin location — only for IN_STOCK serials */}
              <div className="flex items-center gap-2">
                <MapPin size={13} className="text-indigo-400 shrink-0" />
                <input
                  type="text"
                  value={bulkBin}
                  onChange={e => setBulkBin(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') applyBulkBin() }}
                  placeholder={selectedInStock.length > 0 ? 'Bin location (e.g. A1)…' : 'No IN_STOCK serials selected'}
                  disabled={selectedInStock.length === 0}
                  className="flex-1 text-xs border border-indigo-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white disabled:bg-gray-100 disabled:text-gray-400"
                />
                <button
                  onClick={applyBulkBin}
                  disabled={bulkBinSaving || selectedInStock.length === 0}
                  className="flex items-center gap-1.5 text-xs font-medium bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <MapPin size={12} />
                  {bulkBinSaving ? 'Saving…' : 'Set Bin'}
                </button>
              </div>
            </div>
          )}

          {/* Results table */}
          {found.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {/* Select-all checkbox */}
                    <th className="pl-3 pr-1 py-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                    {([
                      ['serialNumber',  'Serial #'],
                      ['sku',           'SKU'],
                      ['vendor',        'Vendor'],
                      ['lastEventType',    'Last Event Type'],
                      ['lastEventDate',   'Date of Last Event'],
                      ['lastMovementType', 'Last Movement'],
                      ['lastMovementDate', 'Date of Last Movement'],
                      ['location',         'Current Location'],
                      ['binLocation',   'Bin'],
                      ['poNumber',      'PO #'],
                      ['cost',          'Cost'],
                      ['note',          'Note'],
                    ] as [string, string][]).map(([col, label]) => (
                      <th
                        key={col}
                        onClick={() => handleSort(col)}
                        className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors"
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          <span className={clsx('text-[10px]', sortCol === col ? 'text-indigo-500' : 'text-gray-300')}>
                            {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedFound.map(r => (
                    <tr key={r.serialNumber} className={clsx('hover:bg-gray-50', selectedIds.has(r.id) && 'bg-indigo-50/50')}>
                      {/* Row checkbox */}
                      <td className="pl-3 pr-1 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleRow(r.id)}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-gray-900">{r.serialNumber}</span>
                          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap', STATUS_COLOR[r.status] ?? 'bg-gray-100 text-gray-600')}>
                            {r.status.replace('_', ' ')}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-gray-700">{r.sku}</span>
                        {r.description && <p className="text-[11px] text-gray-400 truncate max-w-[220px]">{r.description}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-700 whitespace-nowrap">{r.vendor ?? '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-700 whitespace-nowrap">{fmtEventType(r.lastEventType)}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(r.lastEventDate)}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-700 whitespace-nowrap">{fmtEventType(r.lastMovementType)}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(r.lastMovementDate)}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-700">{r.location ?? '—'}</td>
                      <td className="px-3 py-2.5 text-xs font-mono text-gray-500 whitespace-nowrap">{r.binLocation ?? '—'}</td>
                      <td className="px-3 py-2.5 text-xs font-mono text-gray-700 whitespace-nowrap">{r.poNumber ?? '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-700 whitespace-nowrap">
                        {r.cost != null ? `$${r.cost.toFixed(2)}` : '—'}
                      </td>
                      {/* Note cell */}
                      <td className="px-3 py-2.5 min-w-[200px]">
                        {editingId === r.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              type="text"
                              value={editingNote}
                              onChange={e => setEditingNote(e.target.value)}
                              onKeyDown={e => handleNoteKeyDown(e, r.id)}
                              onBlur={() => saveNote(r.id)}
                              className="flex-1 text-xs border border-indigo-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 min-w-0"
                              placeholder="Add a note…"
                            />
                            <button
                              onMouseDown={e => { e.preventDefault(); saveNote(r.id) }}
                              disabled={savingId === r.id}
                              className="p-1 text-indigo-600 hover:text-indigo-800 shrink-0"
                            >
                              <Check size={13} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(r)}
                            className="group flex items-center gap-1.5 text-left w-full"
                          >
                            {r.note ? (
                              <>
                                <span className="text-xs text-gray-700 leading-tight">{r.note}</span>
                                <Pencil size={10} className="shrink-0 text-gray-300 group-hover:text-gray-500 transition-colors" />
                              </>
                            ) : (
                              <span className="text-[11px] text-gray-300 group-hover:text-indigo-500 transition-colors flex items-center gap-1">
                                <Pencil size={10} /> Add note
                              </span>
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Empty state */}
          {searched && found.length === 0 && notFound.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">No results</div>
          )}

        </div>
      </div>
    </div>
  )
}
