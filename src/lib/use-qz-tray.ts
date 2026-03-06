'use client'
import { useState, useEffect, useCallback, useRef } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QZ = any

let qzModule: QZ | null = null
let qzLoadFailed = false

async function getQz(): Promise<QZ> {
  if (qzModule) return qzModule
  if (qzLoadFailed) throw new Error('qz-tray module failed to load')
  try {
    const mod = await import('qz-tray')
    qzModule = mod.default ?? mod
    return qzModule
  } catch (e) {
    qzLoadFailed = true
    throw e
  }
}

export interface UseQzTrayReturn {
  connected: boolean
  connecting: boolean
  printers: string[]
  defaultPrinter: string | null
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  refreshPrinters: () => Promise<void>
  printPdf: (base64: string, printerName?: string) => Promise<void>
  printMultiplePdfs: (base64s: string[], printerName?: string) => Promise<void>
  setDefaultPrinter: (name: string | null) => void
}

/**
 * @param autoConnect — if true, attempts WebSocket connection on mount (use on Settings page).
 *                      Defaults to false to avoid slow multi-port scanning on every page load.
 */
export function useQzTray({ autoConnect = false }: { autoConnect?: boolean } = {}): UseQzTrayReturn {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [printers, setPrinters] = useState<string[]>([])
  const [defaultPrinter, setDefaultPrinterState] = useState<string | null>(null)
  const mountedRef = useRef(true)

  // Load saved default printer from store settings on mount
  useEffect(() => {
    fetch('/api/store-settings')
      .then(r => r.json())
      .then(d => { if (mountedRef.current && d.defaultPrinter) setDefaultPrinterState(d.defaultPrinter) })
      .catch(() => {})
  }, [])

  const connect = useCallback(async () => {
    if (connected || connecting) return
    setConnecting(true)
    try {
      const qz = await getQz()
      if (qz.websocket.isActive()) {
        if (mountedRef.current) setConnected(true)
        return
      }
      qz.security.setCertificatePromise(() => Promise.resolve(''))
      qz.security.setSignaturePromise(() => () => Promise.resolve(''))
      await qz.websocket.connect({ retries: 0 })
      if (mountedRef.current) setConnected(true)
    } catch {
      if (mountedRef.current) setConnected(false)
    } finally {
      if (mountedRef.current) setConnecting(false)
    }
  }, [connected, connecting])

  const disconnect = useCallback(async () => {
    try {
      const qz = await getQz()
      if (qz.websocket.isActive()) await qz.websocket.disconnect()
    } catch { /* ignore */ }
    if (mountedRef.current) { setConnected(false); setPrinters([]) }
  }, [])

  const refreshPrinters = useCallback(async () => {
    if (!connected) return
    try {
      const qz = await getQz()
      const list: string[] = await qz.printers.find()
      if (mountedRef.current) setPrinters(Array.isArray(list) ? list : [])
    } catch {
      if (mountedRef.current) setPrinters([])
    }
  }, [connected])

  const printPdf = useCallback(async (base64: string, printerName?: string) => {
    const printer = printerName ?? defaultPrinter

    // Try QZ Tray first with a 10s timeout
    if (connected && printer) {
      try {
        const qz = await getQz()
        const config = qz.configs.create(printer)
        const data = [{ type: 'pdf', data: base64, flavor: 'base64' }]
        await Promise.race([
          qz.print(config, data),
          new Promise((_, reject) => setTimeout(() => reject(new Error('QZ_TIMEOUT')), 10_000)),
        ])
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (msg !== 'QZ_TIMEOUT') throw e
        console.warn('[QZ] Print timed out, falling back to browser print dialog')
      }
    }

    // Fallback: open PDF in iframe and trigger browser print dialog
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = 'none'
    iframe.src = url
    document.body.appendChild(iframe)
    iframe.onload = () => {
      iframe.contentWindow?.print()
      setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url) }, 60_000)
    }
  }, [defaultPrinter, connected])

  const printMultiplePdfs = useCallback(async (base64s: string[], printerName?: string) => {
    for (const b64 of base64s) {
      await printPdf(b64, printerName)
    }
  }, [printPdf])

  const setDefaultPrinter = useCallback((name: string | null) => {
    setDefaultPrinterState(name)
  }, [])

  // Only auto-connect if explicitly requested (Settings page)
  useEffect(() => {
    mountedRef.current = true
    // Quick-check: if qz-tray module is already loaded and active, just set connected
    if (qzModule) {
      try {
        if (qzModule.websocket.isActive()) setConnected(true)
      } catch { /* ignore */ }
    }
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (autoConnect) connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect])

  // Auto-refresh printers when connected
  useEffect(() => {
    if (connected) refreshPrinters()
  }, [connected, refreshPrinters])

  return {
    connected,
    connecting,
    printers,
    defaultPrinter,
    connect,
    disconnect,
    refreshPrinters,
    printPdf,
    printMultiplePdfs,
    setDefaultPrinter,
  }
}
