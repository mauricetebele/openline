'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { RefreshCcw, AlertCircle, Smartphone, Search, Usb, CheckCircle2, Zap, BatteryCharging, Loader2, ChevronDown } from 'lucide-react'
import { DeviceAgent } from '@/lib/devices/agent-bridge'

interface Diagnostic {
  id: string
  deviceClass: string | null
  serialNumber: string | null
  imei: string | null
  imei2: string | null
  productType: string | null
  marketingName: string | null
  modelNumber: string | null
  regionName: string | null
  iosVersion: string | null
  batteryHealthPct: number | null
  batteryCycleCount: number | null
  batteryCurrentCharge: number | null
  agentVersion: string | null
  createdAt: string
}

// Health thresholds → verdict + color.
function verdictFor(pct: number | null, pass: number, fair: number) {
  if (pct == null) return { label: 'No reading', tone: 'gray' as const }
  if (pct >= pass) return { label: 'Healthy', tone: 'green' as const }
  if (pct >= fair) return { label: 'Fair', tone: 'amber' as const }
  return { label: 'Poor', tone: 'red' as const }
}
const TONE = {
  green: { ring: '#16a34a', text: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  amber: { ring: '#d97706', text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  red:   { ring: '#dc2626', text: 'text-red-700 dark:text-red-400',   bg: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  gray:  { ring: '#9ca3af', text: 'text-gray-500',                    bg: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
}

function CapacityRing({ pct, tone }: { pct: number | null; tone: keyof typeof TONE }) {
  const R = 54, C = 2 * Math.PI * R
  const frac = pct != null ? Math.max(0, Math.min(100, pct)) / 100 : 0
  return (
    <div className="relative w-36 h-36 shrink-0">
      <svg viewBox="0 0 120 120" className="w-36 h-36 -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-gray-200 dark:stroke-gray-700" />
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" strokeLinecap="round"
          stroke={TONE[tone].ring} strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
          style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={clsx('text-3xl font-bold tabular-nums', TONE[tone].text)}>{pct != null ? `${pct}%` : '—'}</span>
        <span className="text-[10px] uppercase tracking-wide text-gray-400">Max Capacity</span>
      </div>
    </div>
  )
}

const fmtWhen = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function DeviceDiagnostics() {
  const [rows, setRows] = useState<Diagnostic[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [latest, setLatest] = useState<Diagnostic | null>(null)
  const [passThreshold, setPassThreshold] = useState(85)
  const fairThreshold = 80

  // Agent state
  const agentRef = useRef<DeviceAgent | null>(null)
  const [agentState, setAgentState] = useState<'idle' | 'connecting' | 'connected' | 'missing'>('idle')
  const [agentVersion, setAgentVersion] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)

  const load = useCallback((q?: string) => {
    setLoading(true)
    fetch(`/api/devices/diagnostics?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      .then(r => r.ok ? r.json() : { diagnostics: [] })
      .then((d: { diagnostics: Diagnostic[] }) => {
        setRows(d.diagnostics ?? [])
        if (!q) setLatest(prev => prev ?? d.diagnostics?.[0] ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setTimeout(() => load(search.trim() || undefined), 300); return () => clearTimeout(t) }, [search, load])

  const connectAgent = useCallback(async () => {
    if (!agentRef.current) agentRef.current = new DeviceAgent()
    setAgentState('connecting'); setError(null)
    const res = await agentRef.current.connect()
    if (res.ok) { setAgentState('connected'); setAgentVersion(res.agentVersion ?? null) }
    else { setAgentState('missing') }
  }, [])

  useEffect(() => { connectAgent(); return () => agentRef.current?.disconnect() }, [connectAgent])

  async function runScan() {
    if (scanning) return
    setError(null)
    if (!agentRef.current?.connected) { await connectAgent(); if (!agentRef.current?.connected) { setError('Local agent not detected. Install/launch it, then retry.'); return } }
    setScanning(true)
    try {
      const raw = await agentRef.current.scan()
      const res = await fetch('/api/devices/diagnostic-scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(raw),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Scan rejected')
      setLatest(data.diagnostic)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const v = verdictFor(latest?.batteryHealthPct ?? null, passThreshold, fairThreshold)

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Agent status + scan control */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className={clsx('inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm',
          agentState === 'connected' ? 'border-green-300 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
          : agentState === 'connecting' ? 'border-gray-300 bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
          : 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300')}>
          {agentState === 'connected' ? <CheckCircle2 size={15} /> : agentState === 'connecting' ? <Loader2 size={15} className="animate-spin" /> : <Usb size={15} />}
          {agentState === 'connected' ? `Agent connected${agentVersion ? ` · v${agentVersion}` : ''}`
            : agentState === 'connecting' ? 'Looking for agent…' : 'Agent not detected'}
        </div>
        {agentState === 'missing' && (
          <button onClick={() => setShowSetup(s => !s)} className="text-xs text-amazon-blue hover:underline inline-flex items-center gap-1">
            Set up agent <ChevronDown size={12} className={clsx(showSetup && 'rotate-180')} />
          </button>
        )}
        <button onClick={runScan} disabled={scanning}
          className="ml-auto inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-amazon-blue text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 shadow">
          {scanning ? <><Loader2 size={16} className="animate-spin" /> Reading device…</> : <><Smartphone size={16} /> Scan Connected iPhone</>}
        </button>
      </div>

      {showSetup && agentState === 'missing' && (
        <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-900/10 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <p className="font-semibold">To scan a physical iPhone, the local device agent must be running on this computer:</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>Install &amp; launch the Open Line device agent (one-time).</li>
            <li>Plug the iPhone in with a data cable, unlock it, and tap <b>Trust</b> on the device.</li>
            <li>Click <b>Scan Connected iPhone</b> above.</li>
          </ol>
          <button onClick={connectAgent} className="mt-1 inline-flex items-center gap-1 text-amazon-blue hover:underline"><RefreshCcw size={11} /> Retry connection</button>
        </div>
      )}

      {error && <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm"><AlertCircle size={14} /> {error}</div>}

      {/* Latest result card */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 mb-5">
        {!latest ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm gap-2">
            <BatteryCharging size={28} className="opacity-40" />
            No scans yet — plug in an iPhone and click <b>Scan Connected iPhone</b>.
          </div>
        ) : (
          <div className="flex flex-col md:flex-row gap-6 items-center md:items-start">
            <CapacityRing pct={latest.batteryHealthPct} tone={v.tone} />
            <div className="flex-1 min-w-0 w-full">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{latest.marketingName ?? latest.productType ?? 'Unknown device'}</h2>
                <span className={clsx('px-2 py-0.5 rounded text-[11px] font-semibold', TONE[v.tone].bg)}>{v.label}</span>
                {latest.iosVersion && <span className="text-xs text-gray-400">iOS {latest.iosVersion}</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 mt-3 text-sm">
                <Stat label="Cycle Count" value={latest.batteryCycleCount != null ? latest.batteryCycleCount.toLocaleString() : '—'} icon={<Zap size={13} />} />
                <Stat label="Charge at scan" value={latest.batteryCurrentCharge != null ? `${latest.batteryCurrentCharge}%` : '—'} />
                <Stat label="Region" value={latest.regionName ?? '—'} />
                <Stat label="Serial" value={latest.serialNumber ?? '—'} mono />
                <Stat label="IMEI" value={latest.imei ?? '—'} mono />
                <Stat label="Model #" value={latest.modelNumber ?? '—'} mono />
              </div>
              <div className="text-[11px] text-gray-400 mt-3">Scanned {fmtWhen(latest.createdAt)}</div>
            </div>
            {/* Threshold control */}
            <div className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
              <label className="block mb-1">Healthy ≥</label>
              <div className="inline-flex items-center gap-1">
                <input type="number" min={1} max={100} value={passThreshold}
                  onChange={e => setPassThreshold(Math.max(1, Math.min(100, Number(e.target.value) || 85)))}
                  className="w-16 h-8 rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 text-sm text-center" />
                <span>%</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* History */}
      <div className="flex items-center gap-3 mb-2">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Recent Scans</h3>
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search serial / IMEI / model…"
            className="h-8 w-64 rounded-md border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 pl-8 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
        </div>
        <button onClick={() => load(search.trim() || undefined)} disabled={loading} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
          <RefreshCcw size={13} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>
      <div className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-800 text-gray-100">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Device</th>
              <th className="px-3 py-2 text-left font-semibold">Capacity</th>
              <th className="px-3 py-2 text-right font-semibold">Cycles</th>
              <th className="px-3 py-2 text-left font-semibold">Serial</th>
              <th className="px-3 py-2 text-left font-semibold">IMEI</th>
              <th className="px-3 py-2 text-left font-semibold">Scanned</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading && rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400"><RefreshCcw size={15} className="animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">{search ? 'No matches.' : 'No scans recorded yet.'}</td></tr>
            ) : rows.map((r, i) => {
              const rv = verdictFor(r.batteryHealthPct, passThreshold, fairThreshold)
              return (
                <tr key={r.id} className={clsx('cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50', i % 2 && 'bg-gray-50/40 dark:bg-gray-800/30')} onClick={() => setLatest(r)}>
                  <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{r.marketingName ?? r.productType ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={clsx('inline-flex items-center gap-1.5 font-semibold', TONE[rv.tone].text)}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: TONE[rv.tone].ring }} />
                      {r.batteryHealthPct != null ? `${r.batteryHealthPct}%` : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.batteryCycleCount ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-gray-500 dark:text-gray-400">{r.serialNumber ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-gray-500 dark:text-gray-400">{r.imei ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtWhen(r.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400 flex items-center gap-1">{icon}{label}</div>
      <div className={clsx('text-gray-800 dark:text-gray-100 truncate', mono && 'font-mono text-xs')} title={value}>{value}</div>
    </div>
  )
}
