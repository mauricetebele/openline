/**
 * Browser ↔ local device-agent bridge.
 *
 * The local agent (a small desktop app the technician installs) talks to the
 * plugged-in iPhone over Apple's usbmux/lockdown protocol — which browsers can't
 * do directly — and exposes a localhost WebSocket. The browser connects to it,
 * asks for a scan, and gets back a RawAppleScan which we POST to
 * /api/devices/diagnostic-scan. This mirrors the QZ Tray localhost bridge pattern.
 *
 * Because the app is served over HTTPS, the agent must serve `wss://` (a trusted
 * localhost cert); we try secure first, then plain `ws://` for local dev.
 *
 * Protocol (JSON frames):
 *   → { id, action: 'ping' }                 ← { id, ok: true, agentVersion }
 *   → { id, action: 'scan' }                 ← { id, ok: true, data: RawAppleScan }
 *                                             ← { id, ok: false, error }
 */

// Ports the agent may listen on (secure, then insecure) — mirrors qz-tray cycling.
const SECURE_PORTS = [17352, 17353]
const INSECURE_PORTS = [17362, 17363]

export interface AgentConnectResult {
  ok: boolean
  agentVersion?: string
  error?: string
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class DeviceAgent {
  private ws: WebSocket | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  agentVersion: string | null = null

  get connected() { return this.ws?.readyState === WebSocket.OPEN }

  /** Try each localhost URL until one opens. Resolves with ping result or ok:false. */
  async connect(timeoutMs = 2500): Promise<AgentConnectResult> {
    if (this.connected) return { ok: true, agentVersion: this.agentVersion ?? undefined }
    const urls = [
      ...SECURE_PORTS.map(p => `wss://localhost:${p}`),
      ...INSECURE_PORTS.map(p => `ws://localhost:${p}`),
    ]
    for (const url of urls) {
      try {
        const ws = await this.openSocket(url, timeoutMs)
        this.ws = ws
        ws.onmessage = (ev) => this.onMessage(ev)
        ws.onclose = () => { this.ws = null }
        const ping = await this.send<{ ok: boolean; agentVersion?: string }>('ping', {}, timeoutMs).catch(() => null)
        if (ping?.ok) { this.agentVersion = ping.agentVersion ?? null; return { ok: true, agentVersion: ping.agentVersion } }
        return { ok: true }
      } catch { /* try next url */ }
    }
    return { ok: false, error: 'Local device agent not detected.' }
  }

  disconnect() { try { this.ws?.close() } catch { /* noop */ } this.ws = null }

  /** Ask the agent to scan the connected device. Returns the RawAppleScan. */
  async scan(timeoutMs = 20000): Promise<Record<string, unknown>> {
    if (!this.connected) throw new Error('Agent not connected')
    const res = await this.send<{ ok: boolean; data?: Record<string, unknown>; error?: string }>('scan', {}, timeoutMs)
    if (!res.ok || !res.data) throw new Error(res.error || 'Scan failed — is a device connected, unlocked, and trusted?')
    return res.data
  }

  private openSocket(url: string, timeoutMs: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket
      try { ws = new WebSocket(url) } catch (e) { reject(e as Error); return }
      const t = setTimeout(() => { try { ws.close() } catch { /* noop */ } reject(new Error('timeout')) }, timeoutMs)
      ws.onopen = () => { clearTimeout(t); resolve(ws) }
      ws.onerror = () => { clearTimeout(t); reject(new Error('connect error')) }
    })
  }

  private send<T>(action: string, extra: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Agent timed out')) }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      try { this.ws!.send(JSON.stringify({ id, action, ...extra })) }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e as Error) }
    })
  }

  private onMessage(ev: MessageEvent) {
    let msg: { id?: number } & Record<string, unknown>
    try { msg = JSON.parse(String(ev.data)) } catch { return }
    if (msg.id == null) return
    const p = this.pending.get(msg.id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(msg.id)
    p.resolve(msg)
  }
}
