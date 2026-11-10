'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { RefreshCcw, AlertCircle, Search, Download, CheckCircle2, Zap, BatteryCharging, Copy, Check, KeyRound, Loader2, ChevronDown, ShieldCheck } from 'lucide-react'
import SickwCheckButton from '@/components/SickwCheckButton'

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
const ago = (s: string | null) => {
  if (!s) return null
  const sec = Math.floor((Date.now() - new Date(s).getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  const m = Math.floor(sec / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function DeviceDiagnostics() {
  const [rows, setRows] = useState<Diagnostic[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [latest, setLatest] = useState<Diagnostic | null>(null)
  const [passThreshold, setPassThreshold] = useState(85)
  const fairThreshold = 80
  const [flash, setFlash] = useState(false)
  const lastIdRef = useRef<string | null>(null)

  // Agent token / status
  const [token, setToken] = useState<string | null>(null)
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showSetup, setShowSetup] = useState(false)

  const load = useCallback((q?: string) => {
    fetch(`/api/devices/diagnostics?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      .then(r => r.ok ? r.json() : { diagnostics: [] })
      .then((d: { diagnostics: Diagnostic[] }) => {
        const list = d.diagnostics ?? []
        setRows(list)
        if (!q && list[0]) {
          // Surface the newest scan live; flash the card if it's a new arrival.
          if (lastIdRef.current && list[0].id !== lastIdRef.current) { setFlash(true); setTimeout(() => setFlash(false), 1200) }
          lastIdRef.current = list[0].id
          setLatest(prev => (!prev || list[0].id !== prev.id) ? list[0] : prev)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setTimeout(() => load(search.trim() || undefined), 300); return () => clearTimeout(t) }, [search, load])
  // Live poll (only when not actively searching) so agent scans appear automatically.
  useEffect(() => {
    const t = setInterval(() => { if (!search.trim()) load() }, 4000)
    return () => clearInterval(t)
  }, [search, load])

  const loadToken = useCallback(() => {
    fetch('/api/devices/agent-token').then(r => r.ok ? r.json() : null)
      .then((d: { token: string; lastSeenAt: string | null } | null) => { if (d) { setToken(d.token); setLastSeenAt(d.lastSeenAt) } })
      .catch(() => {})
  }, [])
  useEffect(() => { loadToken() }, [loadToken])

  async function regenerateToken() {
    if (!confirm('Regenerate the agent token? The old one stops working and you must update the agent config.')) return
    const d = await fetch('/api/devices/agent-token', { method: 'POST' }).then(r => r.json()).catch(() => null)
    if (d?.token) { setToken(d.token); setLastSeenAt(null) }
  }
  function copyToken() {
    if (!token) return
    navigator.clipboard.writeText(token).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  const agentActive = !!lastSeenAt && (Date.now() - new Date(lastSeenAt).getTime()) < 2 * 60 * 1000
  const v = verdictFor(latest?.batteryHealthPct ?? null, passThreshold, fairThreshold)

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Agent setup / status bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <a href="/openline-device-agent.zip" download
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-amazon-blue text-white text-sm font-semibold hover:bg-blue-700 shadow">
          <Download size={16} /> Download Agent
        </a>
        <div className={clsx('inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm',
          agentActive ? 'border-green-300 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
          : 'border-gray-300 bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-300')}>
          {agentActive ? <CheckCircle2 size={15} /> : <Loader2 size={15} className="opacity-50" />}
          {lastSeenAt ? `Agent last posted ${ago(lastSeenAt)}` : 'Agent not connected yet'}
        </div>
        <button onClick={() => setShowSetup(s => !s)} className="text-xs text-amazon-blue hover:underline inline-flex items-center gap-1">
          Setup &amp; token <ChevronDown size={12} className={clsx(showSetup && 'rotate-180')} />
        </button>
      </div>

      {showSetup && (
        <div className="mb-4 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 text-xs text-gray-700 dark:text-gray-300 space-y-3">
          <div>
            <div className="font-semibold mb-1">1. Install the agent (one-time, per computer)</div>
            <p>Click <b>Download Agent</b>, unzip it, and run <code className="font-mono bg-gray-200 dark:bg-gray-700 px-1 rounded">run-windows.bat</code> (Windows) or <code className="font-mono bg-gray-200 dark:bg-gray-700 px-1 rounded">run-mac.sh</code> (Mac). It asks for the site URL and the token below (saved after the first run).</p>
          </div>
          <div>
            <div className="font-semibold mb-1 flex items-center gap-1"><KeyRound size={12} /> 2. Agent token</div>
            <div className="flex items-center gap-2">
              <code className="font-mono text-[11px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 flex-1 min-w-0 truncate">{token ?? '…'}</code>
              <button onClick={copyToken} className="inline-flex items-center gap-1 h-7 px-2 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">
                {copied ? <><Check size={12} className="text-green-600" /> Copied</> : <><Copy size={12} /> Copy</>}
              </button>
              <button onClick={regenerateToken} className="inline-flex items-center gap-1 h-7 px-2 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"><RefreshCcw size={12} /> Regenerate</button>
            </div>
          </div>
          <div>
            <div className="font-semibold mb-1">3. Scan</div>
            <p>Leave the agent running. Plug an iPhone in with a data cable, unlock it, and tap <b>Trust</b> — the scan appears here automatically.</p>
          </div>
        </div>
      )}

      {/* Latest result card */}
      <div className={clsx('rounded-xl border bg-white dark:bg-gray-900 p-5 mb-5 transition-colors',
        flash ? 'border-green-400 ring-2 ring-green-200 dark:ring-green-800' : 'border-gray-200 dark:border-gray-700')}>
        {!latest ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm gap-2">
            <BatteryCharging size={28} className="opacity-40" />
            No scans yet — run the agent and plug in an iPhone.
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
              {/* FMI / iCloud Lock check via SICKW (by IMEI) */}
              {(latest.imei || latest.serialNumber) && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 flex items-center gap-1"><ShieldCheck size={12} /> iCloud / Find My</span>
                  <SickwCheckButton
                    serial={latest.imei ?? latest.serialNumber ?? ''}
                    deviceHint={latest.marketingName ?? latest.productType ?? 'iPhone'}
                  />
                </div>
              )}
              <div className="text-[11px] text-gray-400 mt-3">Scanned {fmtWhen(latest.createdAt)}</div>
            </div>
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
