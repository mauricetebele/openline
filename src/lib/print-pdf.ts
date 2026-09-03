'use client'
/**
 * One-click PDF printing.
 *
 * Prefers QZ Tray: sends the PDF straight to the configured default printer with
 * NO browser dialog (true one-click). If QZ Tray isn't running, no default
 * printer is set, or anything fails, it falls back to a hidden-iframe browser
 * print so labels still come out.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QZ = any
let qzModule: QZ | null = null
let qzLoadFailed = false

async function getQz(): Promise<QZ> {
  if (qzModule) return qzModule
  if (qzLoadFailed) throw new Error('qz-tray module failed to load')
  try {
    const mod = await import('qz-tray')
    qzModule = (mod as { default?: QZ }).default ?? mod
    return qzModule
  } catch (e) {
    qzLoadFailed = true
    throw e
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

async function qzPrint(base64: string, printerName: string): Promise<void> {
  const qz = await getQz()
  if (!qz.websocket.isActive()) {
    qz.security.setCertificatePromise(() => Promise.resolve(''))
    qz.security.setSignaturePromise(() => () => Promise.resolve(''))
    await withTimeout(qz.websocket.connect({ retries: 0 }), 3000)
  }
  const config = qz.configs.create(printerName)
  await qz.print(config, [{ type: 'pixel', format: 'pdf', flavor: 'base64', data: base64 }])
}

function browserPrint(base64: string): void {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none'
  iframe.src = url
  document.body.appendChild(iframe)
  iframe.onload = () => {
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print() } catch { /* ignore */ }
    setTimeout(() => { try { document.body.removeChild(iframe) } catch { /* ignore */ } URL.revokeObjectURL(url) }, 60_000)
  }
}

/**
 * Print a base64 PDF. Returns 'printer' when it went straight to the default
 * printer via QZ Tray (no dialog), or 'dialog' when it fell back to the browser.
 */
export async function printPdfBase64(base64: string): Promise<'printer' | 'dialog'> {
  try {
    const settings = await withTimeout(fetch('/api/store-settings').then(r => r.json()), 2500)
    const printer: string | null = settings?.defaultPrinter ?? null
    if (printer) {
      await qzPrint(base64, printer)
      return 'printer'
    }
  } catch { /* fall through to browser print */ }
  browserPrint(base64)
  return 'dialog'
}
