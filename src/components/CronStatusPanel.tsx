'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { RefreshCcw, AlertCircle, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight, Loader2, Timer } from 'lucide-react'

type RunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STALE'
interface Run {
  id: string
  status: RunStatus
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  detail: string | null
  summary: string | null
  error: string | null
}
interface Cron {
  name: string
  description: string
  schedule: string | null
  nextFireAt: string | null
  running: boolean
  stale: boolean
  latest: (Omit<Run, 'id'>) | null
  progressCurrent: number | null
  progressTotal: number | null
  history: Run[]
}
interface Payload { crons: Cron[]; nextOverall: { name: string; nextFireAt: string } | null; serverTime: string }

function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'now'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const parts: string[] = []
  if (h) parts.push(`${h} hour${h !== 1 ? 's' : ''}`)
  if (h || m) parts.push(`${m} minute${m !== 1 ? 's' : ''}`)
  parts.push(`${sec} second${sec !== 1 ? 's' : ''}`)
  return parts.join(', ')
}
function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60), sec = Math.round(s % 60)
  return `${m}m ${sec}s`
}
function fmtWhen(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
}
function ago(s: string | null, now: number): string {
  if (!s) return 'never'
  const diff = now - new Date(s).getTime()
  if (diff < 0) return 'just now'
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const m = Math.floor(sec / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const STATUS_META: Record<RunStatus, { label: string; cls: string; Icon: React.ElementType }> = {
  RUNNING:   { label: 'Running',   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',       Icon: Loader2 },
  COMPLETED: { label: 'Success',   cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',    Icon: CheckCircle2 },
  FAILED:    { label: 'Failed',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',            Icon: XCircle },
  STALE:     { label: 'Stale',     cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',    Icon: AlertCircle },
}

function StatusBadge({ status }: { status: RunStatus }) {
  const m = STATUS_META[status]
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold', m.cls)}>
      <m.Icon size={11} className={status === 'RUNNING' ? 'animate-spin' : ''} /> {m.label}
    </span>
  )
}

export default function CronStatusPanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const firedRef = useRef(false)

  const load = useCallback(() => {
    fetch('/api/cron-status')
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error ?? String(r.status)))))
      .then((d: Payload) => { setData(d); setError(null); firedRef.current = false })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  // Poll every 8s for live run/progress updates.
  useEffect(() => { const t = setInterval(load, 8000); return () => clearInterval(t) }, [load])
  // 1-second tick for the live countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // When the soonest cron's countdown passes zero, refetch once to pick up the new run.
  const nextMs = data?.nextOverall ? new Date(data.nextOverall.nextFireAt).getTime() - now : null
  useEffect(() => {
    if (nextMs != null && nextMs <= 0 && !firedRef.current) { firedRef.current = true; setTimeout(load, 3000) }
  }, [nextMs, load])

  const toggle = (name: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n
  })

  const runningCount = data?.crons.filter(c => c.running).length ?? 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header: next-scheduled countdown + refresh */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
          <Timer size={15} className="text-indigo-600 dark:text-indigo-400" />
          <span className="text-sm text-indigo-900 dark:text-indigo-200">
            {data?.nextOverall && nextMs != null ? (
              <>Next cron scheduled in <span className="font-semibold tabular-nums">{fmtCountdown(nextMs)}</span>
                <span className="text-indigo-500 dark:text-indigo-400"> · {data.nextOverall.name}</span></>
            ) : 'No scheduled crons'}
          </span>
        </div>
        {runningCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
            <Loader2 size={13} className="animate-spin" /> {runningCount} running
          </span>
        )}
        <button onClick={load} disabled={loading} className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
          <RefreshCcw size={13} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {error && <div className="flex items-center gap-2 px-3 py-2 text-sm text-red-600"><AlertCircle size={14} /> {error}</div>}

      <div className="flex-1 overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
        {!data && loading ? (
          <div className="px-3 py-10 text-center text-gray-400"><RefreshCcw size={16} className="animate-spin inline" /></div>
        ) : data?.crons.map(c => {
          const isOpen = expanded.has(c.name)
          const status: RunStatus | null = c.latest ? (c.latest.status as RunStatus) : null
          const nextIn = c.nextFireAt ? new Date(c.nextFireAt).getTime() - now : null
          const pct = c.progressTotal && c.progressTotal > 0 && c.progressCurrent != null
            ? Math.min(100, Math.round((c.progressCurrent / c.progressTotal) * 100)) : null
          return (
            <div key={c.name} className="bg-white dark:bg-gray-900">
              <button onClick={() => toggle(c.name)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50">
                {isOpen ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold text-gray-800 dark:text-gray-100">{c.name}</span>
                    {status ? <StatusBadge status={status} /> : <span className="text-[10px] text-gray-400">never run</span>}
                    {c.schedule && <span className="text-[10px] text-gray-400 font-mono">{c.schedule}</span>}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">{c.description}</div>
                  {/* Running → progress bar */}
                  {c.running && (
                    <div className="mt-1.5">
                      {pct != null ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] text-blue-600 dark:text-blue-400 tabular-nums shrink-0">{c.progressCurrent}/{c.progressTotal} ({pct}%)</span>
                        </div>
                      ) : (
                        <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                          <div className="h-full w-1/3 bg-blue-500 rounded-full animate-[cronbar_1.2s_ease-in-out_infinite]" />
                        </div>
                      )}
                      {c.latest?.detail && <div className="text-[10px] text-gray-400 mt-0.5">{c.latest.detail}</div>}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 text-[11px] text-gray-500 dark:text-gray-400 space-y-0.5">
                  <div className="flex items-center gap-1 justify-end"><Clock size={10} /> {ago(c.latest?.startedAt ?? null, now)}</div>
                  {nextIn != null && <div className="tabular-nums">next: {fmtCountdown(nextIn)}</div>}
                </div>
              </button>

              {isOpen && (
                <div className="px-9 pb-3 pt-0">
                  {c.latest?.error && (
                    <div className="mb-2 flex items-start gap-2 p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-[11px]">
                      <AlertCircle size={12} className="shrink-0 mt-0.5" /> {c.latest.error}
                    </div>
                  )}
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-gray-400 text-left">
                        <th className="font-medium py-1">Status</th>
                        <th className="font-medium py-1">Started</th>
                        <th className="font-medium py-1">Duration</th>
                        <th className="font-medium py-1">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {c.history.length === 0 ? (
                        <tr><td colSpan={4} className="py-3 text-center text-gray-400">No runs recorded yet.</td></tr>
                      ) : c.history.map(h => (
                        <tr key={h.id}>
                          <td className="py-1.5"><StatusBadge status={h.status} /></td>
                          <td className="py-1.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{fmtWhen(h.startedAt)}</td>
                          <td className="py-1.5 text-gray-600 dark:text-gray-300 tabular-nums">{fmtDuration(h.durationMs)}</td>
                          <td className="py-1.5 text-gray-500 dark:text-gray-400 max-w-md truncate" title={h.error ?? h.summary ?? ''}>
                            {h.error ? <span className="text-red-600 dark:text-red-400">{h.error}</span> : (h.summary ?? '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <style jsx global>{`
        @keyframes cronbar {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  )
}
