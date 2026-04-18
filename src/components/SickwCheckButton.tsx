'use client'

import { useState, useEffect, useRef } from 'react'
import { Loader2, Smartphone, CheckCircle, XCircle, AlertTriangle, RefreshCcw, ChevronDown, Clock } from 'lucide-react'

interface SickwCheckButtonProps {
  serial: string
  /** Optional: compact mode for tight table cells */
  compact?: boolean
}

type CheckStatus = null | 'loading' | 'checking' | 'ON' | 'OFF' | 'ERROR' | 'UNKNOWN'

interface HistoricalCheck {
  status: 'ON' | 'OFF' | 'ERROR' | 'UNKNOWN'
  checkedAt: string
}

function parseCheckResult(resultStr: string): 'ON' | 'OFF' | 'UNKNOWN' {
  const lockMatch = resultStr.match(/iCloud Lock:\s*(?:<[^>]*>)?\s*(ON|OFF)/i)
  return lockMatch ? (lockMatch[1].toUpperCase() as 'ON' | 'OFF') : 'UNKNOWN'
}

export default function SickwCheckButton({ serial, compact }: SickwCheckButtonProps) {
  const [status, setStatus] = useState<CheckStatus>(null)
  const [history, setHistory] = useState<HistoricalCheck[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const isValidSerial = /^[A-Za-z0-9]{8,15}$/.test(serial)

  // Load historical checks on mount
  useEffect(() => {
    if (!isValidSerial) return
    let cancelled = false
    setStatus('loading')

    fetch(`/api/sickw/checks?search=${encodeURIComponent(serial)}&limit=10`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        const checks: HistoricalCheck[] = (json.data ?? []).map((c: { result?: string; status?: string; createdAt?: string }) => {
          const resultStr: string = c.result ?? ''
          const parsed = parseCheckResult(resultStr)
          return {
            status: c.status === 'error' ? 'ERROR' : parsed,
            checkedAt: c.createdAt ?? '',
          } as HistoricalCheck
        })
        setHistory(checks)
        setHistoryLoaded(true)
        // Set status from latest check
        if (checks.length > 0) {
          setStatus(checks[0].status)
        } else {
          setStatus(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryLoaded(true)
          setStatus(null)
        }
      })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowHistory(false)
      }
    }
    if (showHistory) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showHistory])

  async function runCheck() {
    setStatus('checking')
    try {
      const res = await fetch('/api/sickw/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imei: serial, serviceId: 30, serviceName: 'iCloud Lock (FMI) Status' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Check failed')

      const resultStr: string = json.data?.result ?? ''
      const parsed = parseCheckResult(resultStr)
      const newStatus = parsed === 'UNKNOWN' ? 'UNKNOWN' : parsed
      setStatus(newStatus)

      // Prepend new check to history
      const newEntry: HistoricalCheck = {
        status: newStatus,
        checkedAt: new Date().toISOString(),
      }
      setHistory(prev => [newEntry, ...prev])
    } catch {
      setStatus('ERROR')
    }
  }

  if (!isValidSerial) return null

  const sz = compact ? 10 : 12
  const textCls = compact ? 'text-[10px]' : 'text-xs'
  const padCls = compact ? 'px-1.5 py-0.5' : 'px-2.5 py-1'

  if (status === 'loading') {
    return (
      <span className={`inline-flex items-center gap-1 ${padCls} rounded-full bg-gray-50 dark:bg-white/5 text-gray-400 ${textCls}`}>
        <Loader2 size={sz} className="animate-spin" />
      </span>
    )
  }

  if (status === 'checking') {
    return (
      <span className={`inline-flex items-center gap-1 ${padCls} rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ${textCls} font-medium`}>
        <Loader2 size={sz} className="animate-spin" />
        {!compact && 'Checking...'}
      </span>
    )
  }

  // Status badge renderer
  function StatusBadge({ s, showRecheck }: { s: 'ON' | 'OFF' | 'ERROR' | 'UNKNOWN'; showRecheck?: boolean }) {
    if (s === 'ON') {
      return (
        <span className="inline-flex items-center gap-1">
          <span className={`inline-flex items-center gap-1 ${padCls} rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 ${textCls} font-semibold border border-red-200 dark:border-red-500/20`}>
            <XCircle size={sz} />
            iCloud ON
          </span>
          {showRecheck && (
            <button onClick={runCheck} title="Re-check" className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors">
              <RefreshCcw size={sz} />
            </button>
          )}
        </span>
      )
    }
    if (s === 'OFF') {
      return (
        <span className="inline-flex items-center gap-1">
          <span className={`inline-flex items-center gap-1 ${padCls} rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ${textCls} font-semibold border border-emerald-200 dark:border-emerald-500/20`}>
            <CheckCircle size={sz} />
            iCloud OFF
          </span>
          {showRecheck && (
            <button onClick={runCheck} title="Re-check" className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors">
              <RefreshCcw size={sz} />
            </button>
          )}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center gap-1 ${padCls} rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 ${textCls} font-medium border border-amber-200 dark:border-amber-500/20`}>
          <AlertTriangle size={sz} />
          {s === 'ERROR' ? 'Error' : 'Unknown'}
        </span>
        {showRecheck && (
          <button onClick={runCheck} title="Retry" className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors">
            <RefreshCcw size={sz} />
          </button>
        )}
      </span>
    )
  }

  // If we have a result (from history or new check), show badge + history toggle
  if (status === 'ON' || status === 'OFF' || status === 'ERROR' || status === 'UNKNOWN') {
    return (
      <div className="relative inline-flex items-center gap-1" ref={dropdownRef}>
        <StatusBadge s={status} showRecheck />
        {history.length > 0 && (
          <button
            onClick={() => setShowHistory(v => !v)}
            title={`${history.length} historical check${history.length > 1 ? 's' : ''}`}
            className={`p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors ${showHistory ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/10' : ''}`}
          >
            <ChevronDown size={sz} className={`transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
        )}
        {showHistory && history.length > 0 && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg shadow-lg py-1 min-w-[200px]">
            <div className="px-2.5 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-white/5">
              FMI History ({history.length})
            </div>
            <div className="max-h-48 overflow-y-auto">
              {history.map((h, i) => (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-white/5">
                  {h.status === 'ON' && <XCircle size={10} className="text-red-500 shrink-0" />}
                  {h.status === 'OFF' && <CheckCircle size={10} className="text-emerald-500 shrink-0" />}
                  {(h.status === 'ERROR' || h.status === 'UNKNOWN') && <AlertTriangle size={10} className="text-amber-500 shrink-0" />}
                  <span className={`text-[10px] font-medium ${h.status === 'ON' ? 'text-red-600 dark:text-red-400' : h.status === 'OFF' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {h.status === 'ON' ? 'Locked' : h.status === 'OFF' ? 'Unlocked' : h.status === 'ERROR' ? 'Error' : 'Unknown'}
                  </span>
                  <span className="text-[10px] text-gray-400 ml-auto flex items-center gap-0.5 whitespace-nowrap">
                    <Clock size={8} />
                    {h.checkedAt ? new Date(h.checkedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Default: show check button (no historical checks found)
  return (
    <button
      onClick={runCheck}
      className={`inline-flex items-center gap-1 ${padCls} rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ${textCls} font-medium border border-blue-200 dark:border-blue-500/20 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors`}
    >
      <Smartphone size={sz} />
      {compact ? 'FMI' : 'Check iCloud'}
    </button>
  )
}
