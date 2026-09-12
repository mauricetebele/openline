'use client'
/**
 * FMI / SICKW checker for the Serial Search grid. A compact trigger opens a
 * pop-down grid of SICKW services (name + price, searchable); picking one runs
 * that service against the serial and shows the result inline. FMI ON/OFF is
 * parsed into a colored badge; other services show a neutral "Done" with the raw
 * result on hover.
 */
import { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import { Smartphone, Loader2, ChevronDown, Search, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { parseFmiStatus, getFmiService } from '@/lib/sickw/fmi'

interface Service { id: number; name: string; price: number }

// Module-level cache so the service list is fetched once across all rows.
let servicesCache: Service[] | null = null
let servicesPromise: Promise<Service[]> | null = null
async function loadServices(): Promise<Service[]> {
  if (servicesCache) return servicesCache
  if (!servicesPromise) {
    servicesPromise = fetch('/api/sickw/services')
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed to load services'); servicesCache = j.services ?? []; return servicesCache! })
      .catch(e => { servicesPromise = null; throw e })
  }
  return servicesPromise
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

export default function SerialFmiChecker({ serial, deviceHint }: { serial: string; deviceHint?: string }) {
  const [open, setOpen] = useState(false)
  const [services, setServices] = useState<Service[]>(servicesCache ?? [])
  const [loadingServices, setLoadingServices] = useState(false)
  const [servicesErr, setServicesErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ serviceName: string; status: 'ON' | 'OFF' | 'DONE' | 'ERROR'; raw: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const valid = /^[A-Za-z0-9]{8,15}$/.test(serial)
  const defaultService = getFmiService(deviceHint)

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function ensureServices() {
    if (services.length) return
    setLoadingServices(true); setServicesErr(null)
    try { setServices(await loadServices()) }
    catch (e) { setServicesErr(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoadingServices(false) }
  }

  function toggle() { const n = !open; setOpen(n); if (n) ensureServices() }

  async function runCheck(svc: Service) {
    setOpen(false); setRunning(true); setResult(null)
    try {
      const res = await fetch('/api/sickw/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imei: serial, serviceId: svc.id, serviceName: svc.name }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Check failed')
      const raw: string = j.data?.result ?? ''
      const fmi = parseFmiStatus(raw)
      setResult({ serviceName: svc.name, status: fmi ?? 'DONE', raw: stripHtml(raw) || 'No result text' })
    } catch (e) {
      setResult({ serviceName: svc.name, status: 'ERROR', raw: e instanceof Error ? e.message : 'Error' })
    } finally { setRunning(false) }
  }

  if (!valid) return <span className="text-gray-300 text-xs">—</span>

  const q = filter.trim().toLowerCase()
  const filtered = services.filter(s => !q || s.name.toLowerCase().includes(q) || String(s.id) === q)
  const ordered = defaultService
    ? [...filtered].sort((a, b) => (b.id === defaultService.serviceId ? 1 : 0) - (a.id === defaultService.serviceId ? 1 : 0))
    : filtered

  return (
    <div className="relative inline-flex items-center gap-1.5" ref={ref}>
      {running ? (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-medium"><Loader2 size={10} className="animate-spin" />Checking…</span>
      ) : result ? (
        <span title={`${result.serviceName}: ${result.raw}`} className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border',
          result.status === 'ON' ? 'bg-red-50 text-red-600 border-red-200'
            : result.status === 'OFF' ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
              : result.status === 'ERROR' ? 'bg-amber-50 text-amber-600 border-amber-200'
                : 'bg-gray-50 text-gray-600 border-gray-200')}>
          {result.status === 'ON' && <XCircle size={10} />}
          {result.status === 'OFF' && <CheckCircle size={10} />}
          {result.status === 'ERROR' && <AlertTriangle size={10} />}
          {result.status === 'ON' ? 'iCloud ON' : result.status === 'OFF' ? 'iCloud OFF' : result.status === 'ERROR' ? 'Error' : 'Done'}
        </span>
      ) : null}

      <button onClick={toggle} title="Run a SICKW check — pick a service" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-medium border border-blue-200 hover:bg-blue-100 transition-colors">
        <Smartphone size={10} /> {result ? 'Re-check' : 'FMI'} <ChevronDown size={9} className={open ? 'rotate-180' : ''} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl">
          <div className="p-2 border-b border-gray-100 dark:border-white/5">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input autoFocus value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search services…"
                className="w-full h-7 pl-7 pr-2 text-xs rounded border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loadingServices ? (
              <div className="px-3 py-4 text-center text-xs text-gray-400"><Loader2 size={12} className="animate-spin inline mr-1" /> Loading services…</div>
            ) : servicesErr ? (
              <div className="px-3 py-4 text-center text-xs text-red-500">{servicesErr}</div>
            ) : ordered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-400">No services</div>
            ) : ordered.map(s => (
              <button key={s.id} onClick={() => runCheck(s)}
                className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-blue-50 dark:hover:bg-blue-500/10 border-b border-gray-50 dark:border-white/5">
                <span className="text-xs text-gray-700 dark:text-gray-200 truncate">
                  {s.name}
                  {defaultService && s.id === defaultService.serviceId && <span className="ml-1 text-[9px] text-blue-500 font-semibold">(default)</span>}
                </span>
                <span className="text-[10px] text-gray-400 font-mono shrink-0">${s.price.toFixed(3)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
