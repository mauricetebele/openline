'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { AlertCircle, X, ChevronDown, ChevronUp, DollarSign, Plus, Upload, Eye, FileText, Pencil, Check } from 'lucide-react'
import { clsx } from 'clsx'

interface Vendor { id: string; vendorNumber: number; name: string }

interface Adjustment {
  id: string
  label: string
  amount: string
}

interface LedgerEntry {
  id: string
  vendorId: string
  vendor: Vendor
  type: 'DEBIT' | 'CREDIT'
  amount: string
  description: string | null
  vendorInvoiceNo: string | null
  purchaseOrder: { id: string; poNumber: number } | null
  adjustments: Adjustment[]
  fileBase64: string | null
  fileFilename: string | null
  createdAt: string
}

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

export default function VendorLedgerManager() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [vendorId, setVendorId] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Entry form
  const [showForm, setShowForm] = useState(false)
  const [payVendorId, setPayVendorId] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payDesc, setPayDesc] = useState('')
  const [payInvoiceNo, setPayInvoiceNo] = useState('')
  const [payType, setPayType] = useState<'CREDIT' | 'DEBIT'>('CREDIT')
  const [paySaving, setPaySaving] = useState(false)
  const [payFileBase64, setPayFileBase64] = useState<string | null>(null)
  const [payFilename, setPayFilename] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Inline invoice # editing
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)
  const [editingInvoiceVal, setEditingInvoiceVal] = useState('')

  useEffect(() => {
    fetch('/api/vendors')
      .then((r) => r.json())
      .then((d) => setVendors(d.data ?? []))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const url = vendorId ? `/api/vendor-ledger?vendorId=${vendorId}` : '/api/vendor-ledger'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setEntries(data.data)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [vendorId])

  useEffect(() => { load() }, [load])

  // Summaries
  const totalDebits = entries
    .filter((e) => e.type === 'DEBIT')
    .reduce((s, e) => s + parseFloat(e.amount), 0)
  const totalCredits = entries
    .filter((e) => e.type === 'CREDIT')
    .reduce((s, e) => s + parseFloat(e.amount), 0)
  const netBalance = totalDebits - totalCredits

  // Running balance — compute oldest-first, then reverse back to newest-first for display
  const chronological = [...entries].reverse()
  let runningBalance = 0
  const balanceMap = new Map<string, number>()
  for (const e of chronological) {
    if (e.type === 'DEBIT') runningBalance += parseFloat(e.amount)
    else runningBalance -= parseFloat(e.amount)
    balanceMap.set(e.id, runningBalance)
  }
  const rows = entries.map((e) => ({ ...e, balance: balanceMap.get(e.id) ?? 0 }))

  function openForm(type: 'CREDIT' | 'DEBIT') {
    setPayType(type)
    setShowForm(true)
    setPayFileBase64(null)
    setPayFilename(null)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPayFilename(file.name)
    const reader = new FileReader()
    reader.onload = () => setPayFileBase64(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function submitEntry() {
    setErr('')
    const vid = payVendorId || vendorId
    if (!vid) { setErr('Select a vendor'); return }
    if (!payAmount || parseFloat(payAmount) <= 0) { setErr('Enter a valid amount'); return }
    setPaySaving(true)
    try {
      const res = await fetch('/api/vendor-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: vid,
          type: payType,
          amount: parseFloat(payAmount),
          description: payDesc.trim() || undefined,
          vendorInvoiceNo: payInvoiceNo.trim() || undefined,
          fileBase64: payFileBase64 || undefined,
          fileFilename: payFilename || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed')
      }
      setShowForm(false)
      setPayAmount('')
      setPayDesc('')
      setPayInvoiceNo('')
      setPayVendorId('')
      setPayFileBase64(null)
      setPayFilename(null)
      load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setPaySaving(false)
    }
  }

  async function saveInvoiceNo(entryId: string) {
    try {
      const res = await fetch('/api/vendor-ledger', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entryId, vendorInvoiceNo: editingInvoiceVal }),
      })
      if (!res.ok) throw new Error('Failed to update')
      setEditingInvoiceId(null)
      load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const formTitle =
    payType === 'CREDIT'
      ? 'Record Payment (Credit)'
      : 'Manual Debit'

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          className="h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
        >
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              V-{v.vendorNumber} — {v.name}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => openForm('CREDIT')}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700"
        >
          <DollarSign size={14} /> Record Payment
        </button>
        <button
          type="button"
          onClick={() => openForm('CREDIT')}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          <Plus size={14} /> Manual Credit
        </button>
        <button
          type="button"
          onClick={() => openForm('DEBIT')}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700"
        >
          <Plus size={14} /> Manual Debit
        </button>
      </div>

      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Debits</p>
          <p className="text-xl font-bold text-red-600 mt-1">${totalDebits.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Credits</p>
          <p className="text-xl font-bold text-green-600 mt-1">${totalCredits.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Net Balance</p>
          <p className={clsx('text-xl font-bold mt-1', netBalance > 0 ? 'text-red-600' : netBalance < 0 ? 'text-green-600' : 'text-gray-700')}>
            ${netBalance.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Entry form */}
      {showForm && (
        <div className="rounded-lg border bg-white p-4 mb-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">{formTitle}</h3>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            {!vendorId && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Vendor</label>
                <select
                  value={payVendorId}
                  onChange={(e) => setPayVendorId(e.target.value)}
                  className="h-9 rounded-md border border-gray-300 px-2 text-sm"
                >
                  <option value="">Select vendor</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      V-{v.vendorNumber} — {v.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs text-gray-500 block mb-1">Amount</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="h-9 w-36 rounded-md border border-gray-300 pl-6 pr-3 text-sm"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">{payType === 'CREDIT' ? 'Vendor Credit #' : 'Vendor Invoice #'}</label>
              <input
                type="text"
                value={payInvoiceNo}
                onChange={(e) => setPayInvoiceNo(e.target.value)}
                className="h-9 w-36 rounded-md border border-gray-300 px-3 text-sm"
                placeholder={payType === 'CREDIT' ? 'e.g. CR-12345' : 'e.g. INV-12345'}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-gray-500 block mb-1">Description</label>
              <input
                type="text"
                value={payDesc}
                onChange={(e) => setPayDesc(e.target.value)}
                className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm"
                placeholder={payType === 'CREDIT' ? 'e.g. Check #1234' : 'e.g. Late fee'}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Attachment (optional)</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-200"
                >
                  <Upload size={13} /> {payFilename ? 'Change File' : 'Upload File'}
                </button>
                {payFilename && (
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <FileText size={12} /> {payFilename}
                    <button
                      type="button"
                      onClick={() => { setPayFileBase64(null); setPayFilename(null) }}
                      className="text-gray-400 hover:text-red-500 ml-1"
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  onChange={handleFileChange}
                />
              </div>
            </div>
            <div className="flex-1" />
            <button
              type="button"
              onClick={submitEntry}
              disabled={paySaving}
              className={clsx(
                'h-9 px-4 rounded-md text-white text-sm font-medium disabled:opacity-50',
                payType === 'CREDIT' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700',
              )}
            >
              {paySaving ? 'Saving...' : 'Submit'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="py-20 text-center">
          <DollarSign size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">No ledger entries yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                {!vendorId && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendor</th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">PO #</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => {
                const hasAdj = row.adjustments.length > 0
                const isExpanded = expandedId === row.id
                return (
                  <>
                    <tr
                      key={row.id}
                      className={clsx('hover:bg-gray-50', hasAdj && 'cursor-pointer')}
                      onClick={() => hasAdj && setExpandedId(isExpanded ? null : row.id)}
                    >
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {hasAdj && (isExpanded ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />)}
                          {new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </td>
                      {!vendorId && (
                        <td className="px-4 py-3 text-gray-700">V-{row.vendor.vendorNumber} — {row.vendor.name}</td>
                      )}
                      <td className="px-4 py-3">
                        <span
                          className={clsx(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                            row.type === 'DEBIT'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-green-50 text-green-700',
                          )}
                        >
                          {row.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500" onClick={(e) => e.stopPropagation()}>
                        {editingInvoiceId === row.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editingInvoiceVal}
                              onChange={(e) => setEditingInvoiceVal(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveInvoiceNo(row.id); if (e.key === 'Escape') setEditingInvoiceId(null) }}
                              className="h-7 w-28 rounded border border-gray-300 px-2 text-xs"
                              autoFocus
                            />
                            <button type="button" onClick={() => saveInvoiceNo(row.id)} className="text-green-600 hover:text-green-800">
                              <Check size={13} />
                            </button>
                            <button type="button" onClick={() => setEditingInvoiceId(null)} className="text-gray-400 hover:text-gray-600">
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setEditingInvoiceId(row.id); setEditingInvoiceVal(row.vendorInvoiceNo || '') }}
                            className="flex items-center gap-1 text-xs hover:text-gray-900 group/inv"
                            title="Click to edit"
                          >
                            {row.vendorInvoiceNo || <span className="text-gray-300">—</span>}
                            <Pencil size={11} className="opacity-0 group-hover/inv:opacity-100 text-gray-400" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        <div className="flex items-center gap-1.5">
                          {row.description || '—'}
                          {row.fileBase64 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); window.open(row.fileBase64!, '_blank') }}
                              title={row.fileFilename || 'View attachment'}
                              className="text-blue-500 hover:text-blue-700"
                            >
                              <Eye size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {row.purchaseOrder ? `#${row.purchaseOrder.poNumber}` : '—'}
                      </td>
                      <td
                        className={clsx(
                          'px-4 py-3 text-right font-medium',
                          row.type === 'DEBIT' ? 'text-red-600' : 'text-green-600',
                        )}
                      >
                        {row.type === 'DEBIT' ? '+' : '-'}${parseFloat(row.amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        ${row.balance.toFixed(2)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${row.id}-adj`}>
                        <td colSpan={vendorId ? 7 : 8} className="px-0 py-0">
                          <div className="bg-gray-50 border-t border-gray-100 px-10 py-3">
                            <p className="text-xs font-semibold text-gray-500 mb-1.5">Adjustments</p>
                            <div className="space-y-1">
                              {row.adjustments.map((a) => (
                                <div key={a.id} className="flex justify-between text-xs">
                                  <span className="text-gray-600">{a.label}</span>
                                  <span className={parseFloat(a.amount) < 0 ? 'text-green-600' : 'text-gray-700'}>
                                    ${parseFloat(a.amount).toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
