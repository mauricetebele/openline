'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { X, Star, Plus } from 'lucide-react'

const TERMS_LABEL: Record<string, string> = {
  NET_15: 'Net 15', NET_30: 'Net 30', NET_60: 'Net 60',
  NET_90: 'Net 90', DUE_ON_RECEIPT: 'Due on Receipt',
}

interface Address {
  id?: string
  type: 'SHIPPING' | 'BILLING'
  label: string
  addressLine1: string
  addressLine2?: string
  city: string
  state: string
  postalCode: string
  country: string
  isDefault: boolean
}

interface Customer {
  id: string
  companyName: string
  contactName?: string
  phone?: string
  email?: string
  website?: string
  taxExempt: boolean
  taxId?: string
  taxRate: number
  creditLimit?: number
  paymentTerms: string
  defaultDiscount: number
  notes?: string
  active: boolean
  addresses: Address[]
  openBalance: number
  _count: { salesOrders: number }
}

const blankAddr = (): Omit<Address, 'id'> => ({
  type: 'SHIPPING', label: 'Main', addressLine1: '', city: '', state: '',
  postalCode: '', country: 'US', isDefault: false,
})

const blankCustomer = () => ({
  companyName: '', contactName: '', phone: '', email: '', website: '',
  taxExempt: false, taxId: '', taxRate: 0, creditLimit: '',
  paymentTerms: 'NET_30', defaultDiscount: 0, notes: '', active: true,
})

export default function WholesaleCustomersManager() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [tab, setTab] = useState<'info' | 'addresses'>('info')
  const [form, setForm] = useState(blankCustomer())
  const [addresses, setAddresses] = useState<Address[]>([])
  const [showAddAddr, setShowAddAddr] = useState(false)
  const [newAddr, setNewAddr] = useState(blankAddr())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (q = '') => {
    setLoading(true)
    try {
      const res = await fetch(`/api/wholesale/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`)
      const data = await res.json()
      setCustomers(data.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-open create panel when navigated with ?new=1
  useEffect(() => {
    if (searchParams.get('new') === '1') openCreate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(search), 300)
    return () => clearTimeout(t)
  }, [search, load])

  function openCreate() {
    setEditing(null)
    setForm(blankCustomer())
    setAddresses([])
    setTab('info')
    setPanelOpen(true)
  }

  function openEdit(c: Customer) {
    setEditing(c)
    setForm({
      companyName: c.companyName, contactName: c.contactName ?? '',
      phone: c.phone ?? '', email: c.email ?? '', website: c.website ?? '',
      taxExempt: c.taxExempt, taxId: c.taxId ?? '',
      taxRate: Number(c.taxRate), creditLimit: c.creditLimit?.toString() ?? '',
      paymentTerms: c.paymentTerms, defaultDiscount: Number(c.defaultDiscount),
      notes: c.notes ?? '', active: c.active,
    })
    setAddresses(c.addresses)
    setTab('info')
    setPanelOpen(true)
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        ...form,
        taxRate: Number(form.taxRate),
        defaultDiscount: Number(form.defaultDiscount),
        creditLimit: form.creditLimit ? Number(form.creditLimit) : null,
        addresses: editing ? undefined : addresses,
      }

      const res = editing
        ? await fetch(`/api/wholesale/customers/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/wholesale/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

      if (!res.ok) {
        const e = await res.json()
        toast.error(e.error ?? 'Failed to save')
        return
      }

      toast.success(editing ? 'Customer updated' : 'Customer created')
      setPanelOpen(false)
      load(search)
    } finally {
      setSaving(false)
    }
  }

  async function addAddress() {
    if (!editing) {
      setAddresses((prev) => [...prev, { ...newAddr }])
      setNewAddr(blankAddr())
      setShowAddAddr(false)
      return
    }
    const res = await fetch(`/api/wholesale/customers/${editing.id}/addresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newAddr),
    })
    if (!res.ok) { toast.error('Failed to add address'); return }
    toast.success('Address added')
    setNewAddr(blankAddr())
    setShowAddAddr(false)
    const refreshed = await fetch(`/api/wholesale/customers/${editing.id}`).then((r) => r.json())
    setEditing(refreshed)
    setAddresses(refreshed.addresses)
    load(search)
  }

  async function deleteAddress(addr: Address) {
    if (!editing || !addr.id) return
    const res = await fetch(`/api/wholesale/customers/${editing.id}/addresses/${addr.id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Failed to delete address'); return }
    toast.success('Address deleted')
    setAddresses((prev) => prev.filter((a) => a !== addr))
    load(search)
  }

  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Wholesale Customers</h1>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors"
        >
          + New Customer
        </button>
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, contact, email…"
          className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : customers.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No customers found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3">Company</th>
                <th className="text-left px-5 py-3">Contact</th>
                <th className="text-left px-5 py-3">Email</th>
                <th className="text-left px-5 py-3">Terms</th>
                <th className="text-right px-5 py-3">Balance</th>
                <th className="text-right px-5 py-3">Orders</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/wholesale/customers/${c.id}`)}
                >
                  <td className="px-5 py-3 font-medium text-gray-900">{c.companyName}</td>
                  <td className="px-5 py-3 text-gray-600">{c.contactName ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{c.email ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{TERMS_LABEL[c.paymentTerms] ?? c.paymentTerms}</td>
                  <td className="px-5 py-3 text-right font-semibold text-gray-900">{fmt(c.openBalance)}</td>
                  <td className="px-5 py-3 text-right text-gray-500">{c._count.salesOrders}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(c) }}
                      className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Slide-in panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div className="flex-1 bg-black/30" onClick={() => setPanelOpen(false)} />
          <div className="w-[540px] bg-white h-full shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editing ? 'Edit Customer' : 'New Customer'}</h2>
              <button onClick={() => setPanelOpen(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 px-6">
              {(['info', 'addresses'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors capitalize ${
                    tab === t ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {tab === 'info' && (
                <>
                  {[
                    { label: 'Company Name *', key: 'companyName', type: 'text' },
                    { label: 'Contact Name', key: 'contactName', type: 'text' },
                    { label: 'Phone', key: 'phone', type: 'text' },
                    { label: 'Email', key: 'email', type: 'email' },
                    { label: 'Website', key: 'website', type: 'text' },
                  ].map(({ label, key, type }) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                      <input
                        type={type}
                        value={(form as Record<string, unknown>)[key] as string}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      />
                    </div>
                  ))}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms</label>
                      <select
                        value={form.paymentTerms}
                        onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      >
                        {Object.entries(TERMS_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Default Discount %</label>
                      <input
                        type="number" min="0" max="100" step="0.01"
                        value={form.defaultDiscount}
                        onChange={(e) => setForm((f) => ({ ...f, defaultDiscount: Number(e.target.value) }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Tax Rate %</label>
                      <input
                        type="number" min="0" step="0.0001"
                        value={form.taxRate}
                        onChange={(e) => setForm((f) => ({ ...f, taxRate: Number(e.target.value) }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Credit Limit ($)</label>
                      <input
                        type="number" min="0" step="0.01"
                        value={form.creditLimit}
                        onChange={(e) => setForm((f) => ({ ...f, creditLimit: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Tax ID</label>
                    <input
                      type="text"
                      value={form.taxId}
                      onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                  </div>

                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.taxExempt}
                        onChange={(e) => setForm((f) => ({ ...f, taxExempt: e.target.checked }))}
                        className="rounded"
                      />
                      Tax Exempt
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.active}
                        onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                        className="rounded"
                      />
                      Active
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                    <textarea
                      rows={3}
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                    />
                  </div>
                </>
              )}

              {tab === 'addresses' && (
                <div className="space-y-3">
                  {addresses.map((addr, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-3 text-sm relative">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          addr.type === 'SHIPPING' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                        }`}>{addr.type}</span>
                        <span className="text-gray-500">{addr.label}</span>
                        {addr.isDefault && <Star size={12} className="text-yellow-500 fill-yellow-500" />}
                      </div>
                      <p className="text-gray-700">{addr.addressLine1}</p>
                      {addr.addressLine2 && <p className="text-gray-700">{addr.addressLine2}</p>}
                      <p className="text-gray-700">{addr.city}, {addr.state} {addr.postalCode}</p>
                      <button
                        onClick={() => deleteAddress(addr as Address)}
                        className="absolute top-2 right-2 text-gray-300 hover:text-red-400"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}

                  {!showAddAddr && (
                    <button
                      onClick={() => setShowAddAddr(true)}
                      className="flex items-center gap-2 text-sm text-orange-600 hover:text-orange-700 font-medium"
                    >
                      <Plus size={14} /> Add Address
                    </button>
                  )}

                  {showAddAddr && (
                    <div className="border border-orange-200 rounded-lg p-3 space-y-2 bg-orange-50">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-600">Type</label>
                          <select
                            value={newAddr.type}
                            onChange={(e) => setNewAddr((a) => ({ ...a, type: e.target.value as 'SHIPPING' | 'BILLING' }))}
                            className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                          >
                            <option value="SHIPPING">Shipping</option>
                            <option value="BILLING">Billing</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-600">Label</label>
                          <input
                            value={newAddr.label}
                            onChange={(e) => setNewAddr((a) => ({ ...a, label: e.target.value }))}
                            className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                          />
                        </div>
                      </div>
                      <input
                        placeholder="Address Line 1"
                        value={newAddr.addressLine1}
                        onChange={(e) => setNewAddr((a) => ({ ...a, addressLine1: e.target.value }))}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                      />
                      <input
                        placeholder="Address Line 2 (optional)"
                        value={newAddr.addressLine2 ?? ''}
                        onChange={(e) => setNewAddr((a) => ({ ...a, addressLine2: e.target.value }))}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          placeholder="City"
                          value={newAddr.city}
                          onChange={(e) => setNewAddr((a) => ({ ...a, city: e.target.value }))}
                          className="col-span-1 border border-gray-200 rounded px-2 py-1 text-sm"
                        />
                        <input
                          placeholder="State"
                          value={newAddr.state}
                          onChange={(e) => setNewAddr((a) => ({ ...a, state: e.target.value }))}
                          className="border border-gray-200 rounded px-2 py-1 text-sm"
                        />
                        <input
                          placeholder="Zip"
                          value={newAddr.postalCode}
                          onChange={(e) => setNewAddr((a) => ({ ...a, postalCode: e.target.value }))}
                          className="border border-gray-200 rounded px-2 py-1 text-sm"
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newAddr.isDefault}
                          onChange={(e) => setNewAddr((a) => ({ ...a, isDefault: e.target.checked }))}
                        />
                        Set as default
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={addAddress}
                          className="px-3 py-1.5 bg-orange-500 text-white rounded text-xs font-medium hover:bg-orange-600"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => setShowAddAddr(false)}
                          className="px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded text-xs font-medium hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Customer'}
              </button>
              <button
                onClick={() => setPanelOpen(false)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
