'use client'

import { useState } from 'react'
import { Loader2, Smartphone, CheckCircle, XCircle, AlertTriangle, RefreshCcw } from 'lucide-react'

interface SickwCheckButtonProps {
  serial: string
  /** Optional: compact mode for tight table cells */
  compact?: boolean
}

type CheckStatus = null | 'checking' | 'ON' | 'OFF' | 'ERROR' | 'UNKNOWN'

export default function SickwCheckButton({ serial, compact }: SickwCheckButtonProps) {
  const [status, setStatus] = useState<CheckStatus>(null)

  const isValidSerial = /^[A-Za-z0-9]{8,15}$/.test(serial)

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
      const lockMatch = resultStr.match(/iCloud Lock:\s*(?:<[^>]*>)?\s*(ON|OFF)/i)
      setStatus(lockMatch ? (lockMatch[1].toUpperCase() as 'ON' | 'OFF') : 'UNKNOWN')
    } catch {
      setStatus('ERROR')
    }
  }

  if (!isValidSerial) return null

  const sz = compact ? 10 : 12
  const textCls = compact ? 'text-[10px]' : 'text-xs'
  const padCls = compact ? 'px-1.5 py-0.5' : 'px-2.5 py-1'

  if (status === 'checking') {
    return (
      <span className={`inline-flex items-center gap-1 ${padCls} rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ${textCls} font-medium`}>
        <Loader2 size={sz} className="animate-spin" />
        {!compact && 'Checking...'}
      </span>
    )
  }

  if (status === 'ON') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center gap-1 ${padCls} rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 ${textCls} font-semibold border border-red-200 dark:border-red-500/20`}>
          <XCircle size={sz} />
          iCloud ON
        </span>
        <button onClick={runCheck} title="Re-check" className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors">
          <RefreshCcw size={sz} />
        </button>
      </span>
    )
  }

  if (status === 'OFF') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center gap-1 ${padCls} rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ${textCls} font-semibold border border-emerald-200 dark:border-emerald-500/20`}>
          <CheckCircle size={sz} />
          iCloud OFF
        </span>
        <button onClick={runCheck} title="Re-check" className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors">
          <RefreshCcw size={sz} />
        </button>
      </span>
    )
  }

  if (status === 'ERROR' || status === 'UNKNOWN') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center gap-1 ${padCls} rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 ${textCls} font-medium border border-amber-200 dark:border-amber-500/20`}>
          <AlertTriangle size={sz} />
          {status === 'ERROR' ? 'Error' : 'Unknown'}
        </span>
        <button onClick={runCheck} title="Retry" className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors">
          <RefreshCcw size={sz} />
        </button>
      </span>
    )
  }

  // Default: show check button
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
