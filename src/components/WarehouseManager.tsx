'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, X, AlertCircle, Warehouse, ChevronDown, ChevronRight, MapPin, PackageCheck, Building } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Location {
  id: string
  name: string
  warehouseId: string
  isFinishedGoods: boolean
}

interface WarehouseWithLocations {
  id: string
  name: string
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  countryCode?: string
  phone?: string | null
  locations: Location[]
}

// ─── Error Banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onClose} className="shrink-0 hover:text-red-900"><X size={14} /></button>
    </div>
  )
}

// ─── Inline Edit Input ────────────────────────────────────────────────────────

function InlineEdit({
  initial,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string
  placeholder: string
  onSave: (val: string) => Promise<void>
  onCancel: () => void
}) {
  const [val, setVal]     = useState(initial)
  const [saving, setSaving] = useState(false)
  const [err, setErr]     = useState('')

  async function handleSave() {
    if (!val.trim()) { setErr('Name cannot be empty'); return }
    setSaving(true)
    try { await onSave(val.trim()) }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-1">
      {err && <span className="text-xs text-red-500">{err}</span>}
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={val}
          onChange={e => { setVal(e.target.value); setErr('') }}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel() }}
          placeholder={placeholder}
          className="h-7 flex-1 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue"
        />
        <button type="button" onClick={handleSave} disabled={saving}
          className="h-7 px-2 rounded bg-amazon-blue text-white text-xs font-medium disabled:opacity-60">
          {saving ? '…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}
          className="h-7 px-2 rounded border border-gray-200 text-gray-500 text-xs hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Location Row ─────────────────────────────────────────────────────────────

function LocationRow({
  loc,
  onRenamed,
  onDeleted,
  onFGToggled,
}: {
  loc: Location
  onRenamed: (newName: string) => void
  onDeleted: () => void
  onFGToggled: () => void
}) {
  const [editing,   setEditing]   = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [confirm,   setConfirm]   = useState(false)
  const [togglingFG, setTogglingFG] = useState(false)
  const [err,       setErr]       = useState('')

  async function rename(name: string) {
    const res = await fetch(`/api/locations/${loc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Save failed')
    onRenamed(name)
    setEditing(false)
  }

  async function handleDelete() {
    setDeleting(true)
    setErr('')
    try {
      const res = await fetch(`/api/locations/${loc.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Delete failed')
      onDeleted()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
      setConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  async function handleToggleFG() {
    setTogglingFG(true)
    try {
      const res = await fetch(`/api/locations/${loc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFinishedGoods: !loc.isFinishedGoods }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      onFGToggled()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setTogglingFG(false)
    }
  }

  return (
    <div className={clsx(
      'group flex items-center gap-2 py-1.5 pl-4 pr-2 rounded hover:bg-gray-50',
      loc.isFinishedGoods && 'bg-green-50 hover:bg-green-50',
    )}>
      <MapPin size={12} className={clsx('shrink-0', loc.isFinishedGoods ? 'text-green-500' : 'text-gray-300')} />
      {editing ? (
        <InlineEdit
          initial={loc.name}
          placeholder="Location name"
          onSave={rename}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <span className={clsx('text-sm flex-1', loc.isFinishedGoods ? 'text-green-800 font-medium' : 'text-gray-700')}>
            {loc.name}
          </span>
          {loc.isFinishedGoods && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 text-green-700 text-[10px] font-semibold px-2 py-0.5 shrink-0">
              <PackageCheck size={10} /> FG
            </span>
          )}
          {err && <span className="text-xs text-red-500 max-w-[180px] truncate">{err}</span>}
          {confirm ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600 whitespace-nowrap">Delete?</span>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60">Yes</button>
              <button type="button" onClick={() => { setConfirm(false); setErr('') }}
                className="text-xs text-gray-500 hover:underline">No</button>
            </div>
          ) : (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={handleToggleFG}
                disabled={togglingFG}
                title={loc.isFinishedGoods ? 'Unset Finished Goods location' : 'Set as Finished Goods location'}
                className={clsx(
                  'p-1 rounded text-xs disabled:opacity-60',
                  loc.isFinishedGoods
                    ? 'text-green-600 hover:bg-green-100'
                    : 'text-gray-300 hover:text-green-600 hover:bg-green-50',
                )}
              >
                <PackageCheck size={11} />
              </button>
              <button type="button" onClick={() => setEditing(true)}
                className="p-1 rounded text-gray-300 hover:text-amazon-blue hover:bg-blue-50">
                <Pencil size={11} />
              </button>
              <button type="button" onClick={() => setConfirm(true)}
                className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50">
                <Trash2 size={11} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Warehouse Card ───────────────────────────────────────────────────────────

function WarehouseCard({
  wh,
  onChanged,
  onDeleted,
  onReload,
}: {
  wh: WarehouseWithLocations
  onChanged: (updated: WarehouseWithLocations) => void
  onDeleted: () => void
  onReload: () => void
}) {
  const [expanded,     setExpanded]     = useState(true)
  const [editingName,  setEditingName]  = useState(false)
  const [addingLoc,    setAddingLoc]    = useState(false)
  const [newLocName,   setNewLocName]   = useState('')
  const [addingErr,    setAddingErr]    = useState('')
  const [addingSaving, setAddingSaving] = useState(false)
  const [delConfirm,   setDelConfirm]   = useState(false)
  const [deleting,     setDeleting]     = useState(false)
  const [err,          setErr]          = useState('')
  const [editingAddr,  setEditingAddr]  = useState(false)
  const [addrSaving,   setAddrSaving]   = useState(false)
  const [addrErr,      setAddrErr]      = useState('')
  const [addr, setAddr] = useState({
    addressLine1: wh.addressLine1 ?? '',
    addressLine2: wh.addressLine2 ?? '',
    city: wh.city ?? '',
    state: wh.state ?? '',
    postalCode: wh.postalCode ?? '',
    countryCode: wh.countryCode ?? 'US',
    phone: wh.phone ?? '',
  })

  async function renameWarehouse(name: string) {
    const res = await fetch(`/api/warehouses/${wh.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Save failed')
    onChanged({ ...wh, name })
    setEditingName(false)
  }

  async function addLocation() {
    if (!newLocName.trim()) { setAddingErr('Name cannot be empty'); return }
    setAddingSaving(true)
    setAddingErr('')
    try {
      const res = await fetch(`/api/warehouses/${wh.id}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newLocName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to add')
      onChanged({ ...wh, locations: [...wh.locations, data].sort((a, b) => a.name.localeCompare(b.name)) })
      setNewLocName('')
      setAddingLoc(false)
    } catch (e: unknown) {
      setAddingErr(e instanceof Error ? e.message : 'Failed to add')
    } finally {
      setAddingSaving(false)
    }
  }

  async function handleDeleteWarehouse() {
    setDeleting(true)
    setErr('')
    try {
      const res = await fetch(`/api/warehouses/${wh.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Delete failed')
      onDeleted()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
      setDelConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  async function saveAddress() {
    setAddrSaving(true)
    setAddrErr('')
    try {
      const res = await fetch(`/api/warehouses/${wh.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addr),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      onChanged({ ...wh, ...addr })
      setEditingAddr(false)
    } catch (e: unknown) {
      setAddrErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setAddrSaving(false)
    }
  }

  function handleLocRenamed(locId: string, newName: string) {
    onChanged({ ...wh, locations: wh.locations.map(l => l.id === locId ? { ...l, name: newName } : l) })
  }

  function handleLocDeleted(locId: string) {
    onChanged({ ...wh, locations: wh.locations.filter(l => l.id !== locId) })
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Warehouse header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
        <button type="button" onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Warehouse size={14} className="text-gray-400 shrink-0" />

        {editingName ? (
          <div className="flex-1">
            <InlineEdit
              initial={wh.name}
              placeholder="Warehouse name"
              onSave={renameWarehouse}
              onCancel={() => setEditingName(false)}
            />
          </div>
        ) : (
          <>
            <span className="font-semibold text-sm text-gray-800 flex-1">{wh.name}</span>
            <span className="text-xs text-gray-400 mr-2">{wh.locations.length} location{wh.locations.length !== 1 ? 's' : ''}</span>
            {err && <span className="text-xs text-red-500 max-w-[200px] truncate mr-2">{err}</span>}
            {delConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 whitespace-nowrap">Delete warehouse?</span>
                <button type="button" onClick={handleDeleteWarehouse} disabled={deleting}
                  className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60">Yes</button>
                <button type="button" onClick={() => { setDelConfirm(false); setErr('') }}
                  className="text-xs text-gray-500 hover:underline">No</button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setEditingName(true)}
                  className="p-1.5 rounded text-gray-300 hover:text-amazon-blue hover:bg-blue-50">
                  <Pencil size={12} />
                </button>
                <button type="button" onClick={() => setDelConfirm(true)}
                  className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50">
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Address */}
      {expanded && (
        <div className="px-4 py-2 border-b border-gray-100">
          {editingAddr ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Building size={12} className="text-gray-400" />
                <span className="text-xs font-medium text-gray-500">Shipping Address</span>
              </div>
              {addrErr && <span className="text-xs text-red-500">{addrErr}</span>}
              <input value={addr.addressLine1} onChange={e => setAddr(a => ({ ...a, addressLine1: e.target.value }))}
                placeholder="Address line 1" className="w-full h-7 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
              <input value={addr.addressLine2} onChange={e => setAddr(a => ({ ...a, addressLine2: e.target.value }))}
                placeholder="Address line 2" className="w-full h-7 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
              <div className="flex gap-2">
                <input value={addr.city} onChange={e => setAddr(a => ({ ...a, city: e.target.value }))}
                  placeholder="City" className="flex-1 h-7 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
                <input value={addr.state} onChange={e => setAddr(a => ({ ...a, state: e.target.value }))}
                  placeholder="State" className="w-16 h-7 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
                <input value={addr.postalCode} onChange={e => setAddr(a => ({ ...a, postalCode: e.target.value }))}
                  placeholder="ZIP" className="w-20 h-7 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
              </div>
              <input value={addr.phone} onChange={e => setAddr(a => ({ ...a, phone: e.target.value }))}
                placeholder="Phone number" className="w-full h-7 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
              <div className="flex items-center gap-2">
                <button type="button" onClick={saveAddress} disabled={addrSaving}
                  className="h-7 px-3 rounded bg-amazon-blue text-white text-xs font-medium disabled:opacity-60">
                  {addrSaving ? 'Saving…' : 'Save Address'}
                </button>
                <button type="button" onClick={() => { setEditingAddr(false); setAddrErr(''); setAddr({ addressLine1: wh.addressLine1 ?? '', addressLine2: wh.addressLine2 ?? '', city: wh.city ?? '', state: wh.state ?? '', postalCode: wh.postalCode ?? '', countryCode: wh.countryCode ?? 'US', phone: wh.phone ?? '' }) }}
                  className="h-7 px-3 rounded border border-gray-200 text-gray-500 text-xs hover:bg-gray-50">Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setEditingAddr(true)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-amazon-blue">
              <Building size={11} />
              {wh.addressLine1
                ? <span className="text-gray-600">{wh.addressLine1}{wh.city ? `, ${wh.city}` : ''}{wh.state ? ` ${wh.state}` : ''} {wh.postalCode ?? ''}</span>
                : <span>Add shipping address (required for FBA)</span>}
            </button>
          )}
        </div>
      )}

      {/* Locations */}
      {expanded && (
        <div className="px-2 py-2">
          {wh.locations.length === 0 && !addingLoc && (
            <p className="text-xs text-gray-400 px-4 py-1">No locations yet</p>
          )}
          {wh.locations.map(loc => (
            <LocationRow
              key={loc.id}
              loc={loc}
              onRenamed={name => handleLocRenamed(loc.id, name)}
              onDeleted={() => handleLocDeleted(loc.id)}
              onFGToggled={onReload}
            />
          ))}

          {addingLoc ? (
            <div className="pl-4 pr-2 py-1.5">
              {addingErr && <span className="text-xs text-red-500 block mb-1">{addingErr}</span>}
              <div className="flex items-center gap-1">
                <MapPin size={12} className="text-gray-300 shrink-0" />
                <input
                  autoFocus
                  value={newLocName}
                  onChange={e => { setNewLocName(e.target.value); setAddingErr('') }}
                  onKeyDown={e => { if (e.key === 'Enter') addLocation(); if (e.key === 'Escape') { setAddingLoc(false); setNewLocName('') } }}
                  placeholder="Location name…"
                  className="h-7 flex-1 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                />
                <button type="button" onClick={addLocation} disabled={addingSaving}
                  className="h-7 px-2 rounded bg-amazon-blue text-white text-xs font-medium disabled:opacity-60">
                  {addingSaving ? '…' : 'Add'}
                </button>
                <button type="button" onClick={() => { setAddingLoc(false); setNewLocName(''); setAddingErr('') }}
                  className="h-7 px-2 rounded border border-gray-200 text-gray-500 text-xs hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAddingLoc(true)}
              className="flex items-center gap-1 pl-4 pr-2 py-1.5 text-xs text-amazon-blue hover:underline">
              <Plus size={11} /> Add location
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WarehouseManager() {
  const [warehouses, setWarehouses] = useState<WarehouseWithLocations[]>([])
  const [loading,    setLoading]    = useState(true)
  const [err,        setErr]        = useState('')
  const [addingWH,   setAddingWH]   = useState(false)
  const [newWHName,  setNewWHName]  = useState('')
  const [addErr,     setAddErr]     = useState('')
  const [addSaving,  setAddSaving]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/warehouses')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setWarehouses(data.data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function addWarehouse() {
    if (!newWHName.trim()) { setAddErr('Name cannot be empty'); return }
    setAddSaving(true)
    setAddErr('')
    try {
      const res  = await fetch('/api/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newWHName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setWarehouses(p => [...p, { ...data, locations: [] }].sort((a, b) => a.name.localeCompare(b.name)))
      setNewWHName('')
      setAddingWH(false)
    } catch (e: unknown) {
      setAddErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setAddSaving(false)
    }
  }

  function handleChanged(updated: WarehouseWithLocations) {
    setWarehouses(p => p.map(w => w.id === updated.id ? updated : w))
  }

  function handleDeleted(id: string) {
    setWarehouses(p => p.filter(w => w.id !== id))
  }

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-gray-500">
          {warehouses.length} warehouse{warehouses.length !== 1 ? 's' : ''}
        </span>
        <div className="flex-1" />
        {addingWH ? (
          <div className="flex items-center gap-2">
            {addErr && <span className="text-xs text-red-500">{addErr}</span>}
            <input
              autoFocus
              value={newWHName}
              onChange={e => { setNewWHName(e.target.value); setAddErr('') }}
              onKeyDown={e => { if (e.key === 'Enter') addWarehouse(); if (e.key === 'Escape') { setAddingWH(false); setNewWHName('') } }}
              placeholder="Warehouse name…"
              className="h-9 w-48 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
            <button type="button" onClick={addWarehouse} disabled={addSaving}
              className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-60">
              {addSaving ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => { setAddingWH(false); setNewWHName(''); setAddErr('') }}
              className="h-9 px-3 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setAddingWH(true)}
            className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90">
            <Plus size={14} /> Add Warehouse
          </button>
        )}
      </div>

      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading…</div>
      ) : warehouses.length === 0 ? (
        <div className="py-20 text-center">
          <Warehouse size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">No warehouses yet</p>
          <button type="button" onClick={() => setAddingWH(true)}
            className="mt-3 text-sm text-amazon-blue hover:underline">
            Add your first warehouse
          </button>
        </div>
      ) : (
        <div className={clsx('space-y-4 max-w-2xl')}>
          {warehouses.map(wh => (
            <WarehouseCard
              key={wh.id}
              wh={wh}
              onChanged={handleChanged}
              onDeleted={() => handleDeleted(wh.id)}
              onReload={load}
            />
          ))}
        </div>
      )}
    </div>
  )
}
