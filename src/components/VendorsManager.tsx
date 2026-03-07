'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, Search, Pencil, Trash2, X, AlertCircle, Building2, Mail, Phone, User } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string
  vendorNumber: number
  name: string
  contact: string | null
  phone: string | null
  email: string | null
  createdAt: string
}

interface FormState {
  name: string
  contact: string
  phone: string
  email: string
}

const EMPTY_FORM: FormState = { name: '', contact: '', phone: '', email: '' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiPost(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

async function apiPut(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

async function apiDelete(url: string) {
  const res = await fetch(url, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

// ─── Error Banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-4">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onClose} className="shrink-0 hover:text-red-900">
        <X size={14} />
      </button>
    </div>
  )
}

// ─── Vendor Panel ─────────────────────────────────────────────────────────────

function VendorPanel({
  editing,
  onSaved,
  onClose,
}: {
  editing: Vendor | null
  onSaved: () => void
  onClose: () => void
}) {
  const isEdit = editing !== null
  const nameRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState<FormState>(
    editing
      ? { name: editing.name, contact: editing.contact ?? '', phone: editing.phone ?? '', email: editing.email ?? '' }
      : EMPTY_FORM,
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { nameRef.current?.focus() }, [])

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave() {
    setErr('')
    if (!form.name.trim()) { setErr('Vendor name is required'); return }

    setSaving(true)
    try {
      if (isEdit) {
        await apiPut(`/api/vendors/${editing.id}`, form)
      } else {
        await apiPost('/api/vendors', form)
      }
      onSaved()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[420px] bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">
            {isEdit ? 'Edit Vendor' : 'New Vendor'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

          {/* Vendor Name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Vendor Name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Building2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={nameRef}
                type="text"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                placeholder="e.g. Acme Distributors"
                className="w-full h-9 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              />
            </div>
          </div>

          {/* Contact Name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Contact Name
            </label>
            <div className="relative">
              <User size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={form.contact}
                onChange={(e) => set('contact', e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                placeholder="e.g. John Smith"
                className="w-full h-9 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              />
            </div>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Phone
            </label>
            <div className="relative">
              <Phone size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                placeholder="e.g. (555) 123-4567"
                className="w-full h-9 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Email
            </label>
            <div className="relative">
              <Mail size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                placeholder="e.g. orders@acme.com"
                className="w-full h-9 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Vendor'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VendorsManager() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [panel, setPanel] = useState<'create' | Vendor | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const url = search.trim()
        ? `/api/vendors?search=${encodeURIComponent(search.trim())}`
        : '/api/vendors'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setVendors(data.data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await apiDelete(`/api/vendors/${id}`)
      setDeleteConfirm(null)
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            placeholder="Search vendors…"
            className="h-9 w-60 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setPanel('create')}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
        >
          <Plus size={14} />
          New Vendor
        </button>
      </div>

      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading…</div>
      ) : vendors.length === 0 ? (
        <div className="py-20 text-center">
          <Building2 size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">
            {search ? 'No vendors match your search' : 'No vendors yet'}
          </p>
          {!search && (
            <button
              type="button"
              onClick={() => setPanel('create')}
              className="mt-3 text-sm text-amazon-blue hover:underline"
            >
              Add your first vendor
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Vendor ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendor Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vendors.map((vendor) => (
                <tr key={vendor.id} className="hover:bg-gray-50 group">
                  <td className="px-4 py-3 font-mono text-sm text-amazon-blue font-semibold">V-{vendor.vendorNumber}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{vendor.name}</td>
                  <td className="px-4 py-3 text-gray-600">{vendor.contact ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{vendor.phone ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{vendor.email ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3">
                    {deleteConfirm === vendor.id ? (
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xs text-red-600 whitespace-nowrap">Delete?</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(vendor.id)}
                          disabled={deletingId === vendor.id}
                          className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs text-gray-500 hover:underline"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => setPanel(vendor)}
                          className="p-1.5 rounded text-gray-400 hover:text-amazon-blue hover:bg-blue-50"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(vendor.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panel !== null && (
        <VendorPanel
          editing={panel === 'create' ? null : panel}
          onSaved={() => { setPanel(null); load() }}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  )
}
