'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Plus, X, Paperclip, Loader2, CheckCircle2, RotateCcw, Search, Package, Send } from 'lucide-react'

interface Attachment { url: string; filename: string; contentType: string; size: number }
interface CaseRow {
  id: string; caseNumber: number; orderId: string | null; status: 'OPEN' | 'RESOLVED'
  createdBy: { id: string; name: string } | null
  createdAt: string; lastMessageAt: string; resolvedAt: string | null; resolvedByName: string | null
  messageCount: number; unread: boolean
}
interface Message {
  id: string; body: string; attachments: Attachment[]; createdAt: string
  author: { id: string; name: string; role: string }; isAdmin: boolean
}
interface LinkedOrder {
  amazonOrderId: string; olmNumber: number | null; orderSource: string; purchaseDate: string
  workflowStatus: string; orderTotal: number | null; currency: string | null
  shipToName: string | null; shipToCity: string | null; shipToState: string | null
  carrier: string | null; trackingNumber: string | null
  items: { sku: string | null; title: string | null; quantity: number; itemPrice: number | null }[]
}
interface OrderHit { amazonOrderId: string; olmNumber: number | null; orderSource: string; shipToName: string | null; purchaseDate: string }

const fmtDT = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmtD = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
const money = (n: number | null, c: string | null) => n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: c ?? 'USD' })
const isImage = (t: string) => t.startsWith('image/')

async function uploadFiles(files: File[]): Promise<Attachment[]> {
  const out: Attachment[] = []
  for (const file of files) {
    const fd = new FormData(); fd.append('file', file)
    const res = await fetch('/api/cases/upload', { method: 'POST', body: fd })
    const d = await res.json()
    if (res.ok && d.url) out.push({ url: d.url, filename: d.filename, contentType: d.contentType, size: d.size })
  }
  return out
}

function Thumbs({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null
  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      {attachments.map((a, i) => (
        <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" title={a.filename}
          className="block border border-gray-200 rounded-md overflow-hidden hover:border-indigo-400">
          {isImage(a.contentType)
            ? <img src={a.url} alt={a.filename} className="w-20 h-20 object-cover" />
            : <span className="flex items-center justify-center w-20 h-20 text-[10px] text-gray-500 px-1 text-center bg-gray-50">{a.filename}</span>}
        </a>
      ))}
    </div>
  )
}

export default function CustomerServiceCases() {
  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const [cases, setCases] = useState<CaseRow[]>([])
  const [counts, setCounts] = useState({ open: 0, resolved: 0 })
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const loadList = useCallback(() => {
    setLoading(true)
    fetch(`/api/cs-cases?tab=${tab}`).then(r => r.json()).then(d => { setCases(d.cases ?? []); setCounts(d.counts ?? { open: 0, resolved: 0 }) })
      .catch(() => {}).finally(() => setLoading(false))
  }, [tab])
  useEffect(() => { loadList() }, [loadList])

  // Deep link from email notifications: /customer-service?case=<id> auto-opens it.
  useEffect(() => {
    const caseId = new URLSearchParams(window.location.search).get('case')
    if (caseId) setSelectedId(caseId)
  }, [])

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4 p-4">
      {/* Left: list */}
      <div className="w-96 shrink-0 flex flex-col border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 p-2 border-b border-gray-100 dark:border-gray-800">
          <div className="flex gap-1 text-xs">
            {(['open', 'resolved'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setSelectedId(null) }}
                className={clsx('px-2.5 py-1 rounded font-medium capitalize', tab === t ? 'bg-amazon-blue text-white' : 'text-gray-500 hover:text-gray-700')}>
                {t} <span className={clsx('ml-1 text-[10px]', tab === t ? 'text-white/80' : 'text-gray-400')}>{t === 'open' ? counts.open : counts.resolved}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setNewOpen(true)} className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700">
            <Plus size={13} /> New Case
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
          {loading ? <div className="p-6 text-center text-gray-400"><Loader2 className="animate-spin inline" size={16} /></div>
            : cases.length === 0 ? <div className="p-6 text-center text-sm text-gray-400">No {tab} cases.</div>
            : cases.map(c => (
              <button key={c.id} onClick={() => setSelectedId(c.id)}
                className={clsx('w-full text-left px-3 py-2.5', selectedId === c.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60')}>
                <div className="flex items-center gap-2">
                  {c.unread && <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" title="Unread" />}
                  <span className={clsx('text-xs', c.unread ? 'font-bold text-gray-900 dark:text-white' : 'font-medium text-gray-700 dark:text-gray-300')}>CS-{c.caseNumber}</span>
                  {c.orderId && <span className="text-[10px] font-mono text-gray-400 truncate">{c.orderId}</span>}
                  <span className="ml-auto text-[10px] text-gray-400 shrink-0">{fmtDT(c.lastMessageAt)}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-gray-500 truncate">{c.createdBy?.name ?? '—'} · {c.messageCount} msg{c.messageCount === 1 ? '' : 's'}{c.status === 'RESOLVED' ? ' · resolved' : ''}</div>
              </button>
            ))}
        </div>
      </div>

      {/* Right: thread */}
      <div className="flex-1 min-w-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        {selectedId
          ? <CaseThread key={selectedId} id={selectedId} onChanged={loadList} />
          : <div className="h-full flex items-center justify-center text-sm text-gray-400">Select a case to view the conversation.</div>}
      </div>

      {newOpen && <NewCaseModal onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); loadList(); setSelectedId(id) }} />}
    </div>
  )
}

function CaseThread({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [data, setData] = useState<{ case: { id: string; caseNumber: number; orderId: string | null; status: string; createdBy: { name: string } | null; createdAt: string; resolvedAt: string | null; resolvedByName: string | null; messages: Message[] }; linkedOrder: LinkedOrder | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState('')
  const [atts, setAtts] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/cs-cases/${id}`).then(r => r.json()).then(d => { if (!d.error) setData(d) })
      .catch(() => {}).finally(() => setLoading(false))
  }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { bottomRef.current?.scrollIntoView() }, [data?.case.messages.length])

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    try { const up = await uploadFiles(files); setAtts(prev => [...prev, ...up]) } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function send() {
    if (!reply.trim() && atts.length === 0) return
    setSending(true)
    try {
      const res = await fetch(`/api/cs-cases/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply.trim(), attachments: atts }) })
      if (res.ok) { setReply(''); setAtts([]); load(); onChanged() }
    } finally { setSending(false) }
  }

  async function setResolved(reopen: boolean) {
    await fetch(`/api/cs-cases/${id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reopen }) })
    load(); onChanged()
  }

  if (loading || !data) return <div className="h-full flex items-center justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>
  const c = data.case
  const o = data.linkedOrder

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
        <span className="text-sm font-bold text-gray-900 dark:text-white">CS-{c.caseNumber}</span>
        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-semibold', c.status === 'RESOLVED' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800')}>{c.status}</span>
        <span className="text-xs text-gray-500">{c.createdBy?.name}</span>
        <div className="ml-auto">
          {c.status === 'OPEN'
            ? <button onClick={() => setResolved(false)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700"><CheckCircle2 size={13} /> Mark as Resolved</button>
            : <button onClick={() => setResolved(true)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-gray-300 text-gray-600 text-xs font-medium hover:bg-gray-50"><RotateCcw size={13} /> Reopen</button>}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Thread */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {c.messages.map(m => (
              <div key={m.id} className={clsx('flex', m.isAdmin ? 'justify-end' : 'justify-start')}>
                <div className={clsx('max-w-[80%] rounded-lg px-3 py-2', m.isAdmin ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'bg-gray-100 dark:bg-gray-800')}>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-0.5">
                    <span className="font-semibold text-gray-700 dark:text-gray-300">{m.author.name}</span>
                    <span>{fmtDT(m.createdAt)}</span>
                  </div>
                  {m.body && m.body !== '(see attachments)' && <p className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{m.body}</p>}
                  <Thumbs attachments={m.attachments} />
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Reply box */}
          <div className="border-t border-gray-100 dark:border-gray-800 p-2.5 space-y-2">
            {atts.length > 0 && <Thumbs attachments={atts} />}
            <div className="flex items-end gap-2">
              <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} placeholder="Write a reply…"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
                className="flex-1 resize-none rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" />
              <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" onChange={onPickFiles} className="hidden" />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} title="Attach images" className="h-8 w-8 flex items-center justify-center rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
              </button>
              <button onClick={send} disabled={sending || (!reply.trim() && atts.length === 0)} className="h-8 px-3 flex items-center gap-1 rounded-md bg-amazon-blue text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />} Send
              </button>
            </div>
          </div>
        </div>

        {/* Linked order panel */}
        {(c.orderId || o) && (
          <div className="w-72 shrink-0 border-l border-gray-100 dark:border-gray-800 overflow-y-auto p-3 text-xs space-y-2 bg-gray-50/50 dark:bg-gray-900/40">
            <div className="flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-300"><Package size={13} /> Order</div>
            {!o ? (
              <p className="text-gray-400">{c.orderId ? <>Order <span className="font-mono">{c.orderId}</span> not found in system.</> : 'No order linked.'}</p>
            ) : (
              <>
                <div className="font-mono text-amazon-blue">{o.amazonOrderId}{o.olmNumber != null ? ` · OLM-${o.olmNumber}` : ''}</div>
                <KV k="Source" v={o.orderSource} />
                <KV k="Order date" v={fmtD(o.purchaseDate)} />
                <KV k="Customer" v={o.shipToName ?? '—'} />
                <KV k="Ship to" v={[o.shipToCity, o.shipToState].filter(Boolean).join(', ') || '—'} />
                <KV k="Status" v={o.workflowStatus} />
                <KV k="Order total" v={money(o.orderTotal, o.currency)} />
                <KV k="Carrier" v={o.carrier ?? '—'} />
                <KV k="Tracking" v={o.trackingNumber ?? '—'} />
                <div className="pt-1 border-t border-gray-200 dark:border-gray-700">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Items</div>
                  {o.items.map((it, i) => (
                    <div key={i} className="mb-1">
                      <div className="text-gray-700 dark:text-gray-300 leading-tight">{it.title ?? it.sku ?? '—'}</div>
                      <div className="text-gray-400">{it.sku} · qty {it.quantity} · {money(it.itemPrice, o.currency)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-2"><span className="text-gray-500">{k}</span><span className="text-gray-800 dark:text-gray-200 text-right">{v}</span></div>
}

function NewCaseModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [orderId, setOrderId] = useState('')
  const [hits, setHits] = useState<OrderHit[]>([])
  const [showHits, setShowHits] = useState(false)
  const [description, setDescription] = useState('')
  const [atts, setAtts] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const q = orderId.trim()
    if (q.length < 2) { setHits([]); return }
    const t = setTimeout(() => {
      fetch(`/api/cs-cases/order-search?q=${encodeURIComponent(q)}`).then(r => r.json()).then(d => setHits(d.data ?? [])).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [orderId])

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    try { const up = await uploadFiles(files); setAtts(prev => [...prev, ...up]) } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function submit() {
    if (!description.trim() && atts.length === 0) { setErr('Enter a description'); return }
    setSubmitting(true); setErr(null)
    try {
      const res = await fetch('/api/cs-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: orderId.trim() || undefined, description: description.trim(), attachments: atts }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed to create case')
      onCreated(d.id)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to create case') }
    finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">New Case</h3>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {/* Order ID with autocomplete */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 mb-1">Order ID <span className="text-gray-400">(optional)</span></label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={orderId} onChange={e => { setOrderId(e.target.value); setShowHits(true) }} onFocus={() => setShowHits(true)}
                placeholder="Search order id, OLM#, or buyer name…"
                className="w-full h-9 pl-8 pr-3 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
            {showHits && hits.length > 0 && (
              <div className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg">
                {hits.map(h => (
                  <button key={h.amazonOrderId} onClick={() => { setOrderId(h.amazonOrderId); setShowHits(false) }}
                    className="w-full text-left px-3 py-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-xs">
                    <span className="font-mono text-gray-800 dark:text-gray-200">{h.amazonOrderId}</span>
                    <span className="ml-2 text-gray-400">{h.olmNumber != null ? `OLM-${h.olmNumber} · ` : ''}{h.shipToName ?? ''} · {h.orderSource}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description of question</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4}
              placeholder="Describe the question or issue — this becomes the first message of the thread."
              className="w-full resize-none rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" onChange={onPickFiles} className="hidden" />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 text-gray-600 text-xs hover:bg-gray-50">
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Attach images
              </button>
            </div>
            <Thumbs attachments={atts} />
          </div>

          {err && <div className="text-xs text-red-600">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={submitting || uploading} className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? 'Creating…' : 'Create Case'}
          </button>
        </div>
      </div>
    </div>
  )
}
