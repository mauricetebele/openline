'use client'
import { useState, useEffect, useCallback, useRef } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QZ = any

let qzModule: QZ | null = null

async function getQz(): Promise<QZ> {
  if (qzModule) return qzModule
  // Dynamic import — SSR-safe (qz-tray reads `window`/`WebSocket`)
  const mod = await import('qz-tray')
  qzModule = mod.default ?? mod
  return qzModule
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

export function useQzTray(): UseQzTrayReturn {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [printers, setPrinters] = useState<string[]>([])
  const [defaultPrinter, setDefaultPrinterState] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const connectAttemptedRef = useRef(false)

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
      if (qz.websocket.isActive()) { setConnected(true); return }
      // Skip certificate signing for unsigned (personal-use) QZ Tray installs
      qz.security.setCertificatePromise(() => Promise.resolve(''))
      qz.security.setSignaturePromise(() => () => Promise.resolve(''))
      await qz.websocket.connect()
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
    if (!printer) throw new Error('No printer selected')
    const qz = await getQz()
    const config = qz.configs.create(printer, { scaleContent: false })
    const data = [{ type: 'pixel', format: 'pdf', flavor: 'base64', data: base64 }]
    await qz.print(config, data)
  }, [defaultPrinter])

  const printMultiplePdfs = useCallback(async (base64s: string[], printerName?: string) => {
    for (const b64 of base64s) {
      await printPdf(b64, printerName)
    }
  }, [printPdf])

  const setDefaultPrinter = useCallback((name: string | null) => {
    setDefaultPrinterState(name)
  }, [])

  // Auto-connect on mount, auto-disconnect on unmount
  useEffect(() => {
    mountedRef.current = true
    if (!connectAttemptedRef.current) {
      connectAttemptedRef.current = true
      connect()
    }
    return () => {
      mountedRef.current = false
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
