'use client'
import { useEffect, useRef, useState } from 'react'
import { Sparkles, X, Send, Loader2, Database, Search, Mail, CheckCircle2, Ban, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Config { configured: boolean; model: string; isAdmin: boolean }
interface Pending { toolUseId: string; input: any }

type Display =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; input: any }

function toDisplay(messages: any[]): Display[] {
  const out: Display[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') out.push({ kind: 'user', text: m.content })
    } else if (m.role === 'assistant') {
      const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }]
      for (const b of blocks) {
        if (b.type === 'text' && b.text?.trim()) out.push({ kind: 'assistant', text: b.text })
        else if (b.type === 'tool_use') out.push({ kind: 'tool', name: b.name, input: b.input })
      }
    }
  }
  return out
}

const TOOL_META: Record<string, { icon: typeof Database; label: (input: any) => string }> = {
  describe_schema: { icon: Search, label: (i) => i?.table ? `Inspected table "${i.table}"` : 'Listed database tables' },
  query_database: { icon: Database, label: () => 'Queried the database' },
  send_email: { icon: Mail, label: (i) => `Prepared email to ${i?.to ?? '—'}` },
}

export default function AskAI() {
  const [config, setConfig] = useState<Config | null>(null)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fetch('/api/ask-ai/config').then(r => r.ok ? r.json() : null).then(setConfig).catch(() => {}) }, [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, sending, pending])
  // Opened from the top-nav "Ask AI" button (window event) — no floating bubble.
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-ask-ai', handler)
    return () => window.removeEventListener('open-ask-ai', handler)
  }, [])

  if (!config || !config.isAdmin) return null

  const display = toDisplay(messages)

  async function send(next: any[], approved?: string[]) {
    setSending(true); setError('')
    try {
      const res = await fetch('/api/ask-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: next, ...(approved ? { approved } : {}) }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Request failed')
      setMessages(data.messages)
      setPending(data.type === 'confirm' ? data.pending : null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Request failed') }
    finally { setSending(false) }
  }

  function submit() {
    const text = input.trim()
    if (!text || sending || pending) return
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next); setInput('')
    send(next)
  }
  function approve() {
    if (!pending) return
    const p = pending; setPending(null)
    send(messages, [p.toolUseId])
  }
  function decline() {
    if (!pending) return
    const p = pending; setPending(null)
    const next = [...messages, { role: 'user', content: [{ type: 'tool_result', tool_use_id: p.toolUseId, content: 'The user declined to send this email.' }] }]
    setMessages(next); send(next)
  }
  async function saveKey() {
    if (!keyInput.trim()) return
    setSavingKey(true); setError('')
    try {
      const res = await fetch('/api/ask-ai/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: keyInput.trim() }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      setConfig(c => c ? { ...c, configured: true } : c); setKeyInput('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSavingKey(false) }
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[95] flex justify-end bg-black/30" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md h-full bg-white dark:bg-gray-900 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b dark:border-gray-700">
              <Sparkles size={16} className="text-amazon-blue" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Ask AI</h3>
              <span className="text-[10px] text-gray-400">{config.model}</span>
              {messages.length > 0 && <button onClick={() => { setMessages([]); setPending(null); setError('') }} className="ml-auto text-xs text-gray-400 hover:text-gray-600">New chat</button>}
              <button onClick={() => setOpen(false)} className={clsx('text-gray-400 hover:text-gray-600', messages.length === 0 && 'ml-auto')}><X size={17} /></button>
            </div>

            {!config.configured ? (
              /* Setup */
              <div className="flex-1 p-5 space-y-3">
                <p className="text-sm text-gray-600 dark:text-gray-300">Ask AI needs an Anthropic API key to run. It&apos;s stored encrypted and used only for this assistant.</p>
                <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder="sk-ant-…"
                  className="w-full h-9 px-3 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 text-sm font-mono" />
                {error && <div className="text-xs text-red-600">{error}</div>}
                <button onClick={saveKey} disabled={savingKey || !keyInput.trim()} className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
                  {savingKey ? <Loader2 size={14} className="animate-spin" /> : null} Save key
                </button>
                <p className="text-[11px] text-gray-400">Usage is billed to your Anthropic account. Get a key at console.anthropic.com.</p>
              </div>
            ) : (
              <>
                {/* Messages */}
                <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3 space-y-3">
                  {display.length === 0 && (
                    <div className="text-sm text-gray-400 space-y-2 pt-6">
                      <p>Ask about your data, or ask me to deliver it. For example:</p>
                      <ul className="list-disc pl-5 space-y-1 text-gray-500 dark:text-gray-400">
                        <li>&ldquo;Email maurice@openline.us a spreadsheet of all IMEIs shipped on wholesale PO 017787 (SKU, invoice #, serial).&rdquo;</li>
                        <li>&ldquo;How many wholesale orders shipped last week and their total?&rdquo;</li>
                        <li>&ldquo;List the top 10 SKUs by units sold this month.&rdquo;</li>
                      </ul>
                      <p className="text-[11px] text-gray-400 pt-1">It can look up anything (read-only) and will always ask before sending an email.</p>
                    </div>
                  )}
                  {display.map((d, i) => {
                    if (d.kind === 'user') return <div key={i} className="ml-8 rounded-lg bg-amazon-blue text-white px-3 py-2 text-sm whitespace-pre-wrap">{d.text}</div>
                    if (d.kind === 'assistant') return <div key={i} className="mr-6 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 px-3 py-2 text-sm whitespace-pre-wrap">{d.text}</div>
                    const meta = TOOL_META[d.name]
                    const Icon = meta?.icon ?? Database
                    return <div key={i} className="flex items-center gap-1.5 text-[11px] text-gray-400 pl-1"><Icon size={12} /> {meta ? meta.label(d.input) : d.name}</div>
                  })}
                  {sending && <div className="flex items-center gap-1.5 text-xs text-gray-400 pl-1"><Loader2 size={13} className="animate-spin" /> Thinking…</div>}

                  {/* Confirm action */}
                  {pending && (
                    <div className="mr-6 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300"><Mail size={14} /> Send this email?</div>
                      <div className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                        <div><span className="text-gray-400">To:</span> {pending.input?.to}</div>
                        <div><span className="text-gray-400">Subject:</span> {pending.input?.subject}</div>
                        {Array.isArray(pending.input?.attachments) && pending.input.attachments.length > 0 && (
                          <div><span className="text-gray-400">Attachments:</span> {pending.input.attachments.map((a: any) => a.filename).join(', ')}</div>
                        )}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={approve} className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-green-600 text-white text-xs font-semibold hover:bg-green-700"><CheckCircle2 size={13} /> Send</button>
                        <button onClick={decline} className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"><Ban size={13} /> Don&apos;t send</button>
                      </div>
                    </div>
                  )}

                  {error && <div className="flex items-start gap-1.5 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700"><AlertCircle size={13} className="mt-0.5 shrink-0" /> {error}</div>}
                </div>

                {/* Composer */}
                <div className="border-t dark:border-gray-700 p-3">
                  <div className="flex items-end gap-2">
                    <textarea value={input} onChange={e => setInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                      rows={1} placeholder={pending ? 'Confirm the action above first…' : 'Ask anything about your data…'} disabled={sending || !!pending}
                      className="flex-1 resize-none max-h-32 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue disabled:opacity-60" />
                    <button onClick={submit} disabled={sending || !!pending || !input.trim()} className="h-9 w-9 shrink-0 rounded-lg bg-amazon-blue text-white flex items-center justify-center disabled:opacity-40">
                      {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
