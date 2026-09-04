'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import {
  Mail, Inbox, Star, Send, FileText, AlertOctagon, Trash2, Tag, Loader2, X,
  RefreshCw, Reply, Archive, MailOpen, Plus, Search, Paperclip,
} from 'lucide-react'

interface Account { id: string; email: string; displayName?: string | null }
interface GLabel { id: string; name: string; type: string; messagesUnread?: number }
interface MsgSummary { id: string; threadId: string; from: string; subject: string; snippet: string; date: number | null; unread: boolean; labelIds: string[] }
interface MsgDetail {
  id: string; threadId: string; from: string; to: string; cc: string; subject: string
  messageId: string; references: string; date: number | null; labelIds: string[]
  html: string; text: string; attachments: { filename: string; mimeType: string; attachmentId: string; size: number }[]
}

const SYSTEM_FOLDERS = [
  { id: 'INBOX', name: 'Inbox', icon: Inbox },
  { id: 'STARRED', name: 'Starred', icon: Star },
  { id: 'SENT', name: 'Sent', icon: Send },
  { id: 'DRAFT', name: 'Drafts', icon: FileText },
  { id: 'SPAM', name: 'Spam', icon: AlertOctagon },
  { id: 'TRASH', name: 'Trash', icon: Trash2 },
]

function parseFrom(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/)
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() }
  return { name: raw.trim(), email: raw.trim() }
}
function fmtDate(ms: number | null): string {
  if (!ms) return ''
  const d = new Date(ms); const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function MailClient() {
  const params = useSearchParams()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [configured, setConfigured] = useState(true)
  const [activeAccount, setActiveAccount] = useState<string>('')
  const [labels, setLabels] = useState<GLabel[]>([])
  const [folder, setFolder] = useState('INBOX')
  const [search, setSearch] = useState('')
  const [messages, setMessages] = useState<MsgSummary[]>([])
  const [nextToken, setNextToken] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<MsgDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [compose, setCompose] = useState<null | { to: string; cc: string; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string }>(null)
  const [sending, setSending] = useState(false)
  const bootstrapped = useRef(false)

  // ── Loaders ──
  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/email/accounts')
    const d = await res.json()
    setConfigured(d.configured ?? true)
    setAccounts(d.accounts ?? [])
    return d.accounts as Account[]
  }, [])

  const loadLabels = useCallback(async (accountId: string) => {
    try { const d = await (await fetch(`/api/email/labels?accountId=${accountId}`)).json(); setLabels(d.labels ?? []) } catch { /* ignore */ }
  }, [])

  const loadMessages = useCallback(async (accountId: string, folderId: string, q: string) => {
    setLoadingList(true); setSelected(null); setDetail(null)
    try {
      const qp = new URLSearchParams({ accountId, labelIds: folderId })
      if (q.trim()) qp.set('q', q.trim())
      const d = await (await fetch(`/api/email/messages?${qp.toString()}`)).json()
      if (d.error) throw new Error(d.error)
      setMessages(d.messages ?? []); setNextToken(d.nextPageToken ?? null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load mail') }
    finally { setLoadingList(false) }
  }, [])

  const loadMore = useCallback(async () => {
    if (!nextToken || !activeAccount) return
    const qp = new URLSearchParams({ accountId: activeAccount, labelIds: folder, pageToken: nextToken })
    if (search.trim()) qp.set('q', search.trim())
    const d = await (await fetch(`/api/email/messages?${qp.toString()}`)).json()
    setMessages(prev => [...prev, ...(d.messages ?? [])]); setNextToken(d.nextPageToken ?? null)
  }, [nextToken, activeAccount, folder, search])

  // Bootstrap
  useEffect(() => {
    if (bootstrapped.current) return; bootstrapped.current = true
    ;(async () => {
      const accts = await loadAccounts()
      if (accts.length) { setActiveAccount(accts[0].id); loadLabels(accts[0].id); loadMessages(accts[0].id, 'INBOX', '') }
    })()
  }, [loadAccounts, loadLabels, loadMessages])

  // OAuth redirect feedback
  useEffect(() => {
    const connected = params.get('connected'); const error = params.get('error')
    if (connected) { toast.success(`Connected ${connected}`); window.history.replaceState({}, '', '/mail') }
    else if (error) { toast.error(error === 'not_configured' ? 'Gmail OAuth is not configured yet' : `Connect failed: ${error}`); window.history.replaceState({}, '', '/mail') }
  }, [params])

  function switchAccount(id: string) { setActiveAccount(id); setFolder('INBOX'); setSearch(''); loadLabels(id); loadMessages(id, 'INBOX', '') }
  function openFolder(id: string) { setFolder(id); setSearch(''); loadMessages(activeAccount, id, '') }
  function runSearch() { loadMessages(activeAccount, folder, search) }

  async function openMessage(id: string) {
    setSelected(id); setLoadingDetail(true); setDetail(null)
    try {
      const d = await (await fetch(`/api/email/messages/${id}?accountId=${activeAccount}`)).json()
      if (d.error) throw new Error(d.error)
      setDetail(d)
      setMessages(prev => prev.map(m => m.id === id ? { ...m, unread: false } : m)) // reflect read
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to open message') }
    finally { setLoadingDetail(false) }
  }

  async function modify(id: string, add: string[] | undefined, remove: string[] | undefined, removeFromList = false) {
    await fetch(`/api/email/messages/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: activeAccount, addLabelIds: add, removeLabelIds: remove }) })
    if (removeFromList) { setMessages(prev => prev.filter(m => m.id !== id)); if (selected === id) { setSelected(null); setDetail(null) } }
  }
  async function archive(id: string) { await modify(id, undefined, ['INBOX'], folder === 'INBOX'); toast.success('Archived') }
  async function markUnread(id: string) { await modify(id, ['UNREAD'], undefined); setMessages(prev => prev.map(m => m.id === id ? { ...m, unread: true } : m)); toast.success('Marked unread') }
  async function trash(id: string) {
    await fetch(`/api/email/messages/${id}?accountId=${activeAccount}`, { method: 'DELETE' })
    setMessages(prev => prev.filter(m => m.id !== id)); if (selected === id) { setSelected(null); setDetail(null) }
    toast.success('Moved to Trash')
  }

  function startReply() {
    if (!detail) return
    const to = parseFrom(detail.from).email
    setCompose({
      to, cc: '', subject: detail.subject.startsWith('Re:') ? detail.subject : `Re: ${detail.subject}`,
      body: '', threadId: detail.threadId, inReplyTo: detail.messageId,
      references: [detail.references, detail.messageId].filter(Boolean).join(' '),
    })
  }
  function startCompose() { setCompose({ to: '', cc: '', subject: '', body: '' }) }

  async function sendMail() {
    if (!compose) return
    if (!compose.to.trim()) { toast.error('Enter a recipient'); return }
    setSending(true)
    try {
      const html = escapeHtml(compose.body).replace(/\n/g, '<br>')
      const res = await fetch('/api/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        accountId: activeAccount, to: compose.to, cc: compose.cc || undefined, subject: compose.subject, html,
        threadId: compose.threadId, inReplyTo: compose.inReplyTo, references: compose.references,
      }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Send failed')
      toast.success('Sent'); setCompose(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Send failed') }
    finally { setSending(false) }
  }

  const userLabels = labels.filter(l => l.type === 'user')

  // ── Not-connected states ──
  if (!bootstrapped.current || accounts.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 p-8 text-center">
        <Mail size={40} className="text-gray-300" />
        {!configured ? (
          <>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Gmail isn&apos;t configured yet</p>
            <p className="text-xs text-gray-400 max-w-md">Add a Google OAuth client (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET) in the environment, then reload to connect a mailbox.</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">No mailbox connected</p>
            <a href="/api/email/google/connect" className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700"><Plus size={15} /> Connect a Gmail account</a>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="px-4 py-2.5 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 flex items-center gap-3">
        <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5"><Mail size={16} className="text-amazon-blue" /> Mail</h1>
        <select value={activeAccount} onChange={e => switchAccount(e.target.value)} className="h-8 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2 text-xs text-gray-800 dark:text-gray-200 max-w-[220px]">
          {accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
        </select>
        <a href="/api/email/google/connect" title="Connect another account" className="text-xs text-amazon-blue hover:underline inline-flex items-center gap-1"><Plus size={12} /> Add</a>
        <div className="flex-1" />
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()} placeholder="Search mail…"
            className="h-8 w-56 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 pl-7 pr-2 text-xs text-gray-800 dark:text-gray-200" />
        </div>
        <button onClick={startCompose} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-amazon-blue text-white text-xs font-semibold hover:bg-blue-700"><Plus size={14} /> Compose</button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Folders */}
        <div className="w-44 shrink-0 border-r bg-gray-50 dark:bg-gray-900/50 dark:border-gray-700 overflow-y-auto py-2">
          {SYSTEM_FOLDERS.map(f => {
            const I = f.icon; const active = folder === f.id
            const unread = labels.find(l => l.id === f.id)?.messagesUnread
            return (
              <button key={f.id} onClick={() => openFolder(f.id)} className={clsx('w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium', active ? 'bg-amazon-blue/10 text-amazon-blue' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5')}>
                <I size={14} /> <span className="flex-1 text-left">{f.name}</span>
                {f.id === 'INBOX' && unread ? <span className="text-[10px] font-bold text-amazon-blue">{unread}</span> : null}
              </button>
            )
          })}
          {userLabels.length > 0 && <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Labels</p>}
          {userLabels.map(l => (
            <button key={l.id} onClick={() => openFolder(l.id)} className={clsx('w-full flex items-center gap-2 px-3 py-1.5 text-xs', folder === l.id ? 'bg-amazon-blue/10 text-amazon-blue' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5')}>
              <Tag size={13} /> <span className="flex-1 text-left truncate">{l.name}</span>
            </button>
          ))}
        </div>

        {/* List */}
        <div className="w-[360px] shrink-0 border-r dark:border-gray-700 overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-1.5 border-b dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{SYSTEM_FOLDERS.find(f => f.id === folder)?.name ?? userLabels.find(l => l.id === folder)?.name ?? folder}</span>
            <button onClick={() => loadMessages(activeAccount, folder, search)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white"><RefreshCw size={13} /></button>
          </div>
          {loadingList ? (
            <div className="py-16 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</div>
          ) : messages.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">No messages</div>
          ) : (
            <>
              {messages.map(m => {
                const f = parseFrom(m.from)
                return (
                  <button key={m.id} onClick={() => openMessage(m.id)} className={clsx('w-full text-left px-3 py-2 border-b dark:border-gray-800 block', selected === m.id ? 'bg-amazon-blue/10' : 'hover:bg-gray-50 dark:hover:bg-white/5')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={clsx('text-xs truncate', m.unread ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300')}>{f.name}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{fmtDate(m.date)}</span>
                    </div>
                    <div className={clsx('text-xs truncate', m.unread ? 'font-semibold text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-400')}>{m.subject || '(no subject)'}</div>
                    <div className="text-[11px] text-gray-400 truncate">{m.snippet}</div>
                  </button>
                )
              })}
              {nextToken && <button onClick={loadMore} className="w-full py-2 text-xs text-amazon-blue hover:underline">Load more</button>}
            </>
          )}
        </div>

        {/* Reading pane */}
        <div className="flex-1 overflow-y-auto">
          {loadingDetail ? (
            <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</div>
          ) : !detail ? (
            <div className="py-20 text-center text-sm text-gray-300">Select a message</div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="px-5 py-3 border-b dark:border-gray-700 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">{detail.subject || '(no subject)'}</h2>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={startReply} title="Reply" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"><Reply size={15} /></button>
                    <button onClick={() => archive(detail.id)} title="Archive" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"><Archive size={15} /></button>
                    <button onClick={() => markUnread(detail.id)} title="Mark unread" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"><MailOpen size={15} /></button>
                    <button onClick={() => trash(detail.id)} title="Trash" className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 hover:text-red-500"><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-medium text-gray-700 dark:text-gray-200">{parseFrom(detail.from).name}</span> &lt;{parseFrom(detail.from).email}&gt; · {fmtDate(detail.date)}
                </div>
                <div className="text-[11px] text-gray-400">to {detail.to}{detail.cc ? ` · cc ${detail.cc}` : ''}</div>
                {detail.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detail.attachments.map((a, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded"><Paperclip size={10} /> {a.filename}</span>
                    ))}
                  </div>
                )}
              </div>
              <iframe
                title="message"
                sandbox=""
                className="flex-1 w-full bg-white"
                srcDoc={detail.html || `<pre style="font-family:system-ui;white-space:pre-wrap;padding:16px;font-size:13px">${escapeHtml(detail.text)}</pre>`}
              />
            </div>
          )}
        </div>
      </div>

      {/* Compose */}
      {compose && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setCompose(null)}>
          <div className="w-full sm:max-w-2xl bg-white dark:bg-gray-900 rounded-t-xl sm:rounded-xl shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{compose.threadId ? 'Reply' : 'New message'}</h3>
              <button onClick={() => setCompose(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white"><X size={16} /></button>
            </div>
            <div className="px-4 py-3 space-y-2">
              <input value={compose.to} onChange={e => setCompose({ ...compose, to: e.target.value })} placeholder="To" className="w-full h-9 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2.5 text-sm text-gray-900 dark:text-white" />
              <input value={compose.cc} onChange={e => setCompose({ ...compose, cc: e.target.value })} placeholder="Cc (optional)" className="w-full h-9 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2.5 text-sm text-gray-900 dark:text-white" />
              <input value={compose.subject} onChange={e => setCompose({ ...compose, subject: e.target.value })} placeholder="Subject" className="w-full h-9 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2.5 text-sm text-gray-900 dark:text-white" />
              <textarea value={compose.body} onChange={e => setCompose({ ...compose, body: e.target.value })} rows={12} placeholder="Write your message…" className="w-full rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800 px-2.5 py-2 text-sm text-gray-900 dark:text-white resize-none" />
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t dark:border-gray-700">
              <button onClick={() => setCompose(null)} className="h-9 px-4 rounded-md border border-gray-300 dark:border-white/15 text-sm text-gray-600 dark:text-gray-300">Discard</button>
              <button onClick={sendMail} disabled={sending} className="inline-flex items-center gap-1.5 h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
