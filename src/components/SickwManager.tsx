'use client'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Search, Loader2, ChevronDown, ChevronUp,
  CheckCircle, XCircle, ChevronLeft, ChevronRight,
} from 'lucide-react'

// ─── Service catalog ─────────────────────────────────────────────────────────

interface Service {
  id: number
  name: string
  price: string
}

interface Category {
  label: string
  services: Service[]
}

const SERVICE_CATALOG: Category[] = [
  {
    label: 'Apple',
    services: [
      { id: 3,  name: 'iCloud ON/OFF',              price: '0.12' },
      { id: 61, name: 'Carrier & FMI & Blacklist',  price: '0.30' },
      { id: 30, name: 'Basic Info',                  price: '0.07' },
      { id: 88, name: 'Activation',                  price: '0.15' },
      { id: 81, name: 'MDM Lock',                    price: '0.12' },
      { id: 40, name: 'MDM & iCloud',                price: '0.18' },
      { id: 8,  name: 'SIM-Lock',                    price: '0.15' },
      { id: 12, name: 'IMEI ↔ SN',                   price: '0.07' },
    ],
  },
  {
    label: 'Carrier / Status',
    services: [
      { id: 16,  name: 'T-Mobile USA',      price: '0.20' },
      { id: 9,   name: 'Verizon USA',       price: '0.20' },
      { id: 65,  name: 'AT&T USA',          price: '0.20' },
      { id: 6,   name: 'Worldwide Blacklist', price: '0.15' },
      { id: 220, name: 'TracFone',           price: '0.25' },
    ],
  },
  {
    label: 'Samsung',
    services: [
      { id: 1,  name: 'Samsung PRO',   price: '0.25' },
      { id: 80, name: 'Samsung Info',  price: '0.10' },
      { id: 82, name: 'Knox Guard',    price: '0.15' },
    ],
  },
  {
    label: 'Generic',
    services: [
      { id: 203, name: 'Brand & Model',     price: '0.07' },
      { id: 42,  name: 'Google Pixel',      price: '0.20' },
      { id: 13,  name: 'Motorola',          price: '0.15' },
      { id: 15,  name: 'Huawei',            price: '0.15' },
      { id: 206, name: 'Xiaomi MI Lock',    price: '0.15' },
      { id: 39,  name: 'Oppo / OnePlus',    price: '0.15' },
    ],
  },
]

const ALL_SERVICES = SERVICE_CATALOG.flatMap(c =>
  c.services.map(s => ({ ...s, category: c.label }))
)

// ─── Types ───────────────────────────────────────────────────────────────────

interface CheckRecord {
  id: string
  imei: string
  serviceId: number
  serviceName: string
  status: string
  result: string | null
  cost: number | null
  createdAt: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SickwManager() {
  // Check form
  const [imei, setImei] = useState('')
  const [selectedCategory, setSelectedCategory] = useState(SERVICE_CATALOG[0].label)
  const [selectedServiceId, setSelectedServiceId] = useState<number>(SERVICE_CATALOG[0].services[0].id)
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<{ status: string; data: Record<string, unknown> } | null>(null)

  // History
  const [checks, setChecks] = useState<CheckRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [searchImei, setSearchImei] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const currentCategory = SERVICE_CATALOG.find(c => c.label === selectedCategory) ?? SERVICE_CATALOG[0]

  // Reset service selection when category changes
  useEffect(() => {
    const cat = SERVICE_CATALOG.find(c => c.label === selectedCategory)
    if (cat && !cat.services.some(s => s.id === selectedServiceId)) {
      setSelectedServiceId(cat.services[0].id)
    }
  }, [selectedCategory, selectedServiceId])

  // Fetch history
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (searchImei.trim()) params.set('search', searchImei.trim())
      const res = await fetch(`/api/sickw/checks?${params}`)
      if (!res.ok) throw new Error('Failed to load history')
      const data = await res.json()
      setChecks(data.checks)
      setTotal(data.total)
      setPages(data.pages)
    } catch {
      toast.error('Failed to load check history')
    } finally {
      setLoadingHistory(false)
    }
  }, [page, searchImei])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  // Run check
  async function handleCheck(e: React.FormEvent) {
    e.preventDefault()
    if (running) return
    const svc = ALL_SERVICES.find(s => s.id === selectedServiceId)
    if (!svc) return

    setRunning(true)
    setLastResult(null)
    try {
      const res = await fetch('/api/sickw/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imei: imei.trim(), serviceId: svc.id, serviceName: svc.name }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Check failed')
      setLastResult({ status: json.status, data: json.data })
      toast.success('Check complete')
      fetchHistory()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const selectedSvc = ALL_SERVICES.find(s => s.id === selectedServiceId)

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* ── Check Form ─────────────────────────────────────────────────── */}
      <div className="card p-6 max-w-3xl">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Run IMEI Check</h2>
        <form onSubmit={handleCheck} className="space-y-4">
          <div>
            <label className="label">IMEI / Serial Number</label>
            <input
              className="input font-mono"
              placeholder="e.g. 353456789012345"
              value={imei}
              onChange={e => setImei(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
              maxLength={15}
              required
            />
            <p className="text-xs text-gray-400 mt-1">{imei.length}/15 characters (11-15 required)</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Category</label>
              <select
                className="input"
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
              >
                {SERVICE_CATALOG.map(c => (
                  <option key={c.label} value={c.label}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Service</label>
              <select
                className="input"
                value={selectedServiceId}
                onChange={e => setSelectedServiceId(Number(e.target.value))}
              >
                {currentCategory.services.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} (${s.price})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              className="btn-primary"
              disabled={running || imei.length < 11}
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {running ? 'Checking…' : `Run Check — $${selectedSvc?.price ?? '?'}`}
            </button>
          </div>
        </form>
      </div>

      {/* ── Last Result ────────────────────────────────────────────────── */}
      {lastResult && (
        <div className={`card p-5 max-w-3xl border-l-4 ${
          lastResult.status === 'success' ? 'border-l-green-500' : 'border-l-red-500'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            {lastResult.status === 'success'
              ? <CheckCircle size={16} className="text-green-500" />
              : <XCircle size={16} className="text-red-500" />}
            <span className="text-sm font-semibold">
              {lastResult.status === 'success' ? 'Check Successful' : 'Check Failed'}
            </span>
          </div>
          <pre className="text-xs bg-gray-50 rounded-lg p-4 overflow-auto max-h-80 whitespace-pre-wrap font-mono">
            {JSON.stringify(lastResult.data, null, 2)}
          </pre>
        </div>
      )}

      {/* ── History ────────────────────────────────────────────────────── */}
      <div className="card max-w-5xl">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="text-sm font-semibold text-gray-900">Check History</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-8 py-1.5 text-xs w-48"
                placeholder="Search by IMEI…"
                value={searchImei}
                onChange={e => { setSearchImei(e.target.value); setPage(1) }}
              />
            </div>
            <span className="text-xs text-gray-400">{total} total</span>
          </div>
        </div>

        {loadingHistory && checks.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            <Loader2 size={20} className="animate-spin mx-auto mb-2" />
            Loading…
          </div>
        ) : checks.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            No checks yet. Run your first IMEI check above.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-left px-4 py-2">IMEI</th>
                    <th className="text-left px-4 py-2">Service</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-right px-4 py-2">Cost</th>
                    <th className="text-center px-4 py-2 w-12">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.map(c => {
                    const isExpanded = expandedId === c.id
                    return (
                      <tr key={c.id} className="border-b last:border-b-0 hover:bg-gray-50">
                        <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(c.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{c.imei}</td>
                        <td className="px-4 py-2 text-xs">{c.serviceName}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                            c.status === 'success'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {c.status === 'success'
                              ? <CheckCircle size={10} />
                              : <XCircle size={10} />}
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-mono">
                          {c.cost != null ? `$${Number(c.cost).toFixed(4)}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : c.id)}
                            className="p-1 rounded hover:bg-gray-200 transition-colors"
                            title="Toggle result"
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Expanded result */}
            {expandedId && (() => {
              const c = checks.find(x => x.id === expandedId)
              if (!c?.result) return null
              let parsed: unknown
              try { parsed = JSON.parse(c.result) } catch { parsed = c.result }
              return (
                <div className="px-4 py-3 border-t bg-gray-50">
                  <pre className="text-xs font-mono whitespace-pre-wrap overflow-auto max-h-60">
                    {typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}
                  </pre>
                </div>
              )
            })()}

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn-secondary text-xs"
                >
                  <ChevronLeft size={12} /> Prev
                </button>
                <span className="text-xs text-gray-500">
                  Page {page} of {pages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(pages, p + 1))}
                  disabled={page >= pages}
                  className="btn-secondary text-xs"
                >
                  Next <ChevronRight size={12} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
