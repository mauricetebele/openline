'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Search, Send, MessageSquare, AlertCircle, CheckCircle2,
  Package, MapPin, Calendar, ChevronDown, ChevronUp, Loader2,
  User, Building2, PenLine, Bell, BellOff, RefreshCw, Settings,
  ExternalLink, X,
} from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderItem {
  asin: string | null; sellerSku: string | null; title: string | null; quantityOrdered: number
}
interface OrderInfo {
  id: string; olmNumber: number | null; purchaseDate: string; orderStatus: string
  shipToName: string | null; shipToCity: string | null; shipToState: string | null; shipToPostal: string | null
  items: OrderItem[]
}
interface AvailableAction { name: string; label: string }
interface Message {
  id: string; amazonOrderId: string; messageType: string; body: string
  isInbound: boolean; sentAt: string; sentBy: string | null
}
interface MessagingData {
  amazonOrderId: string
  order: OrderInfo | null
  availableActions: AvailableAction[]
  messagingError: string | null
  sentMessages: Message[]
}

interface SubscriptionStatus {
  status:        'ACTIVE' | 'INACTIVE' | 'FAILED' | 'NO_ACCOUNT'
  subscription:  { sqsArn?: string; subscriptionId?: string; destinationId?: string; errorMessage?: string } | null
  sqsConfigured: boolean
  awsConfigured: boolean
  apiVerified:   boolean | null
}

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  confirmOrderDetails:         'Confirm Order Details',
  confirmDeliveryDetails:      'Confirm Delivery Details',
  legalDisclosure:             'Legal Disclosure',
  negativeFeedbackRemoval:     'Request Feedback Removal',
  confirmCustomizationDetails: 'Confirm Customization',
  unexpectedProblem:           'Unexpected Problem',
  sendDigitalAccessKey:        'Digital Access Key',
  buyerReply:                  'Buyer Reply',
  manualLog:                   'Logged Message',
  sellerMessage:               'Seller Message',
}

type Mode = 'outbound' | 'inbound'

// ─── Notifications Panel ──────────────────────────────────────────────────────

function NotificationsPanel() {
  const [open,          setOpen]          = useState(false)
  const [status,        setStatus]        = useState<SubscriptionStatus | null>(null)
  const [loading,       setLoading]       = useState(false)
  const [polling,       setPolling]       = useState(false)
  const [sqsArnInput,   setSqsArnInput]   = useState('')
  const [actionResult,  setActionResult]  = useState<{ ok: boolean; message: string } | null>(null)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/messaging/subscribe')
      const data = await res.json() as SubscriptionStatus
      setStatus(data)
      if (data.subscription?.sqsArn) setSqsArnInput(data.subscription.sqsArn)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) fetchStatus() }, [open, fetchStatus])

  async function handleSubscribe() {
    setLoading(true); setActionResult(null)
    try {
      const res = await fetch('/api/messaging/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sqsArn: sqsArnInput.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionResult({ ok: false, message: data.error ?? 'Subscription failed' })
      } else {
        setActionResult({ ok: true, message: 'Subscription activated! Amazon will now push new buyer messages to your SQS queue.' })
        await fetchStatus()
      }
    } catch {
      setActionResult({ ok: false, message: 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleUnsubscribe() {
    setLoading(true); setActionResult(null)
    try {
      await fetch('/api/messaging/subscribe', { method: 'DELETE' })
      setActionResult({ ok: true, message: 'Subscription removed.' })
      await fetchStatus()
    } finally {
      setLoading(false)
    }
  }

  async function handlePoll() {
    setPolling(true); setActionResult(null)
    try {
      const res = await fetch('/api/messaging/poll', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setActionResult({ ok: false, message: data.error ?? 'Poll failed' })
      } else {
        const { processed, errors } = data as { processed: number; errors: string[] }
        setActionResult({
          ok: errors.length === 0,
          message: processed > 0
            ? `${processed} new message${processed !== 1 ? 's' : ''} captured from SQS.`
            : errors.length > 0
              ? `Poll errors: ${errors.join(', ')}`
              : 'No new messages in queue.',
        })
      }
    } catch {
      setActionResult({ ok: false, message: 'Network error' })
    } finally {
      setPolling(false)
    }
  }

  const isActive = status?.status === 'ACTIVE'

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header — toggle */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isActive
            ? <Bell size={15} className="text-green-500" />
            : <BellOff size={15} className="text-gray-400" />}
          <span className="text-sm font-semibold text-gray-800">Auto-Capture Setup</span>
          <span className={clsx(
            'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
            isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500',
          )}>
            {status ? status.status : '—'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 size={13} className="animate-spin text-gray-400" />}
          {open ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4 text-sm">

          {/* Explainer */}
          <div className="text-xs text-gray-500 space-y-1">
            <p>
              Amazon SP-API can push new buyer messages to an <strong>AWS SQS queue</strong>.
              Once set up, this app will automatically capture inbound messages — no more manual pasting.
            </p>
            <p className="text-gray-400">
              Requires: an AWS account, an SQS Standard queue with the correct Amazon policy,
              and AWS credentials in your <code className="bg-gray-100 px-1 rounded">.env</code> file.
            </p>
          </div>

          {/* Setup checklist */}
          <div className="space-y-1.5">
            <CheckRow ok={!!status?.awsConfigured}  label="AWS credentials configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)" />
            <CheckRow ok={!!status?.sqsConfigured}  label="SQS_QUEUE_URL set in .env" />
            <CheckRow ok={isActive}                 label="SP-API subscription active" />
            {isActive && status?.apiVerified === false && (
              <p className="text-xs text-amber-600 pl-5">⚠ SP-API reports subscription not found — it may have been deleted externally.</p>
            )}
          </div>

          {/* SQS ARN input */}
          {!isActive && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-700">SQS Queue ARN</label>
              <input
                value={sqsArnInput}
                onChange={e => setSqsArnInput(e.target.value)}
                placeholder="arn:aws:sqs:us-east-1:123456789012:amazon-notifications"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amazon-orange focus:border-transparent"
              />
              <p className="text-[10px] text-gray-400">
                Leave blank to use <code>SQS_QUEUE_ARN</code> from your .env file.
              </p>
            </div>
          )}

          {/* AWS policy instructions */}
          {!isActive && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer font-medium text-gray-600 hover:text-gray-800 flex items-center gap-1">
                <Settings size={11} /> SQS policy required by Amazon
              </summary>
              <pre className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded text-[10px] overflow-x-auto whitespace-pre-wrap">{`{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "sns.amazonaws.com" },
    "Action": "sqs:SendMessage",
    "Resource": "<your-queue-arn>",
    "Condition": {
      "ArnLike": {
        "aws:SourceArn": "arn:aws:sns:*:437568002678:*"
      }
    }
  }]
}`}</pre>
              <a
                href="https://developer-docs.amazon.com/sp-api/docs/notifications-api-v1-use-case-guide"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-amazon-orange hover:underline mt-1"
              >
                SP-API Notifications guide <ExternalLink size={10} />
              </a>
            </details>
          )}

          {/* Action result */}
          {actionResult && (
            <div className={clsx(
              'flex items-start gap-2 rounded-lg p-2.5 text-xs',
              actionResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700',
            )}>
              {actionResult.ok ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> : <AlertCircle size={13} className="shrink-0 mt-0.5" />}
              {actionResult.message}
              <button type="button" onClick={() => setActionResult(null)} className="ml-auto shrink-0"><X size={11} /></button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {!isActive ? (
              <button
                type="button"
                onClick={handleSubscribe}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
                Activate Subscription
              </button>
            ) : (
              <button
                type="button"
                onClick={handleUnsubscribe}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <BellOff size={12} />}
                Remove Subscription
              </button>
            )}

            <button
              type="button"
              onClick={handlePoll}
              disabled={polling || !status?.sqsConfigured}
              title={!status?.sqsConfigured ? 'SQS_QUEUE_URL not configured' : 'Check SQS queue for new messages now'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {polling ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Check Queue Now
            </button>

            <button
              type="button"
              onClick={fetchStatus}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={11} />
              Refresh Status
            </button>
          </div>

          {/* Active state details */}
          {isActive && status?.subscription && (
            <div className="text-[11px] text-gray-500 space-y-0.5 border-t border-gray-100 pt-3">
              <p><span className="font-medium">Queue:</span> <code className="font-mono">{status.subscription.sqsArn}</code></p>
              <p><span className="font-medium">Subscription ID:</span> <code className="font-mono text-gray-400">{status.subscription.subscriptionId}</code></p>
              <p className="text-gray-400">New buyer messages will be captured automatically. Use &quot;Check Queue Now&quot; to pull any waiting messages immediately, or set up a cron job to call <code>POST /api/messaging/poll</code> every few minutes.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok
        ? <CheckCircle2 size={12} className="text-green-500 shrink-0" />
        : <AlertCircle size={12} className="text-amber-500 shrink-0" />}
      <span className={ok ? 'text-gray-600' : 'text-gray-500'}>{label}</span>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MessagingPage() {
  const [searchInput, setSearchInput] = useState('')
  const [loading,     setLoading]     = useState(false)
  const [data,        setData]        = useState<MessagingData | null>(null)
  const [fetchError,  setFetchError]  = useState<string | null>(null)
  const [showItems,   setShowItems]   = useState(false)

  const [mode,         setMode]         = useState<Mode>('outbound')
  const [selectedType, setSelectedType] = useState('')
  const [messageBody,  setMessageBody]  = useState('')
  const [sending,      setSending]      = useState(false)
  const [sendResult,   setSendResult]   = useState<{ ok: boolean; error?: string; apiSent?: boolean } | null>(null)

  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [data?.sentMessages.length])

  async function load(orderId: string) {
    setLoading(true)
    setFetchError(null)
    try {
      const res  = await fetch(`/api/messaging/${encodeURIComponent(orderId)}`)
      const json = await res.json()
      if (!res.ok) setFetchError(json.error ?? 'Unknown error')
      else {
        setData(json)
        if (json.availableActions?.length > 0) setSelectedType(json.availableActions[0].name)
      }
    } catch {
      setFetchError('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const orderId = searchInput.trim().toUpperCase()
    if (!orderId) return
    setData(null); setSendResult(null); setMessageBody(''); setMode('outbound')
    await load(orderId)
  }

  const canUseApi = (data?.availableActions.length ?? 0) > 0

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!data || !messageBody.trim()) return

    setSending(true); setSendResult(null)
    try {
      const isManual = mode === 'outbound' && !canUseApi
      const payload =
        mode === 'inbound'   ? { body: messageBody, isInbound: true } :
        isManual             ? { body: messageBody, manual: true, messageType: selectedType || undefined } :
        /* api outbound */     { body: messageBody, messageType: selectedType }

      const res  = await fetch(`/api/messaging/${encodeURIComponent(data.amazonOrderId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        setSendResult({ ok: false, error: json.error ?? 'Failed' })
      } else {
        setSendResult({ ok: true, apiSent: json.apiSent })
        setMessageBody('')
        await load(data.amazonOrderId)
      }
    } catch {
      setSendResult({ ok: false, error: 'Network error' })
    } finally {
      setSending(false)
    }
  }

  function fmtTime(iso: string) {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  const thread = data ? [...data.sentMessages].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()) : []
  const canSend = !!messageBody.trim()

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">

      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <MessageSquare className="text-amazon-orange" size={24} />
          Buyer-Seller Messaging
        </h1>
        <p className="text-sm text-gray-500 mt-1">Look up an order to view and log correspondence.</p>
      </div>

      {/* Notifications panel */}
      <NotificationsPanel />

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Enter Amazon Order ID (e.g. 111-1234567-1234567)"
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amazon-orange focus:border-transparent"
          />
        </div>
        <button type="submit" disabled={loading || !searchInput.trim()}
          className="px-4 py-2 bg-amazon-orange text-white rounded-lg text-sm font-medium hover:bg-amazon-orange/90 disabled:opacity-50 flex items-center gap-1.5">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          Look up
        </button>
      </form>

      {fetchError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          <AlertCircle size={15} className="shrink-0" />{fetchError}
        </div>
      )}

      {data && (
        <div className="space-y-4">

          {/* Order context card */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Order</p>
                <p className="text-base font-bold text-gray-900 font-mono">{data.amazonOrderId}</p>
              </div>
              {data.order ? (
                <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full',
                  data.order.orderStatus === 'Unshipped' ? 'bg-blue-100 text-blue-700' :
                  data.order.orderStatus === 'PartiallyShipped' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-600',
                )}>{data.order.orderStatus}</span>
              ) : (
                <span className="text-xs text-gray-400 italic">Not in local DB</span>
              )}
            </div>
            {data.order ? (
              <div className="px-4 py-3 space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  {data.order.olmNumber && (
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <Package size={13} className="text-gray-400 shrink-0" />
                      <span className="font-medium">OLM #{data.order.olmNumber}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-gray-600">
                    <Calendar size={13} className="text-gray-400 shrink-0" />
                    {new Date(data.order.purchaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                  {data.order.shipToName && (
                    <div className="flex items-center gap-1.5 text-gray-600 col-span-2">
                      <MapPin size={13} className="text-gray-400 shrink-0" />
                      {data.order.shipToName}
                      {(data.order.shipToCity || data.order.shipToState) && (
                        <span className="text-gray-400 ml-1">— {[data.order.shipToCity, data.order.shipToState, data.order.shipToPostal].filter(Boolean).join(', ')}</span>
                      )}
                    </div>
                  )}
                </div>
                {data.order.items.length > 0 && (
                  <div>
                    <button type="button" onClick={() => setShowItems(v => !v)}
                      className="flex items-center gap-1 text-xs text-amazon-orange hover:underline font-medium">
                      {showItems ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      {data.order.items.length} item{data.order.items.length !== 1 ? 's' : ''}
                    </button>
                    {showItems && (
                      <ul className="mt-2 space-y-1">
                        {data.order.items.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                            <Package size={13} className="text-gray-400 mt-0.5 shrink-0" />
                            <span className="font-medium">{item.title ?? item.asin ?? item.sellerSku}</span>
                            <span className="text-gray-400">× {item.quantityOrdered}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="px-4 py-3 text-xs text-gray-400">
                This order isn&apos;t in the local database — you can still log correspondence below.
              </div>
            )}
          </div>

          {/* API status note (subtle — not blocking) */}
          {!canUseApi && (
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <AlertCircle size={13} className="text-amber-500 shrink-0" />
              Amazon API messaging not available for this order (order may be shipped/delivered or outside the messaging window).
              You can still log all correspondence manually below.
            </div>
          )}

          {/* Conversation */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Conversation</h2>
              <span className="text-xs text-gray-400">{thread.length} message{thread.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Thread bubbles */}
            <div ref={threadRef} className="px-4 py-4 space-y-3 min-h-[180px] max-h-[380px] overflow-y-auto bg-gray-50">
              {thread.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-10 text-center">
                  <MessageSquare size={28} className="text-gray-200 mb-2" />
                  <p className="text-sm text-gray-400">No messages logged yet.</p>
                  <p className="text-xs text-gray-300 mt-1">Use the compose area below to log correspondence.</p>
                </div>
              ) : (
                thread.map(msg => {
                  const isManualOut = !msg.isInbound && (msg.messageType === 'manualLog' || !canUseApi)
                  return (
                    <div key={msg.id} className={clsx('flex gap-2', msg.isInbound ? 'justify-start' : 'justify-end')}>
                      {msg.isInbound && (
                        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mt-0.5">
                          <User size={14} className="text-gray-500" />
                        </div>
                      )}
                      <div className={clsx(
                        'max-w-[75%] rounded-2xl px-3.5 py-2.5 shadow-sm',
                        msg.isInbound
                          ? 'bg-white border border-gray-200 rounded-tl-sm'
                          : isManualOut
                            ? 'bg-gray-700 text-white rounded-tr-sm'
                            : 'bg-amazon-blue text-white rounded-tr-sm',
                      )}>
                        <p className={clsx('text-[10px] font-medium mb-1', msg.isInbound ? 'text-gray-400' : 'text-white/70')}>
                          {msg.isInbound
                            ? 'Buyer'
                            : isManualOut
                              ? 'You (logged)'
                              : `You · ${MESSAGE_TYPE_LABELS[msg.messageType] ?? msg.messageType}`}
                        </p>
                        <p className={clsx('text-sm whitespace-pre-wrap leading-relaxed', msg.isInbound ? 'text-gray-800' : 'text-white')}>
                          {msg.body}
                        </p>
                        <p className={clsx('text-[10px] mt-1.5', msg.isInbound ? 'text-gray-400' : 'text-white/50')}>
                          {fmtTime(msg.sentAt)}{msg.sentBy && !msg.isInbound ? ` · ${msg.sentBy}` : ''}
                        </p>
                      </div>
                      {!msg.isInbound && (
                        <div className={clsx(
                          'w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                          isManualOut ? 'bg-gray-200' : 'bg-amazon-blue/10',
                        )}>
                          {isManualOut
                            ? <PenLine size={12} className="text-gray-500" />
                            : <Building2 size={12} className="text-amazon-blue" />}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {/* Compose */}
            <div className="border-t border-gray-200 px-4 py-4 bg-white space-y-3">

              {/* Mode toggle */}
              <div className="flex gap-2">
                <button type="button" onClick={() => setMode('outbound')}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    mode === 'outbound'
                      ? canUseApi ? 'bg-amazon-blue text-white border-amazon-blue' : 'bg-gray-700 text-white border-gray-700'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400',
                  )}>
                  {canUseApi ? <Send size={12} /> : <PenLine size={12} />}
                  {canUseApi ? 'Send to Buyer' : 'Log Outbound'}
                </button>
                <button type="button" onClick={() => setMode('inbound')}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    mode === 'inbound'
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400',
                  )}>
                  <User size={12} /> Log Buyer Reply
                </button>
              </div>

              <form onSubmit={handleSend} className="space-y-2">

                {/* Message type selector — outbound with API only */}
                {mode === 'outbound' && canUseApi && (
                  <select value={selectedType} onChange={e => setSelectedType(e.target.value)}
                    className="w-full h-8 px-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amazon-orange">
                    {data.availableActions.map(a => (
                      <option key={a.name} value={a.name}>{a.label}</option>
                    ))}
                  </select>
                )}

                {mode === 'outbound' && !canUseApi && (
                  <p className="text-xs text-gray-500">Log a message you sent through Seller Central to keep a record here.</p>
                )}
                {mode === 'inbound' && (
                  <p className="text-xs text-gray-500">Paste the message received from the buyer (from your email or Seller Central).</p>
                )}

                <div className="flex gap-2 items-end">
                  <textarea
                    value={messageBody}
                    onChange={e => setMessageBody(e.target.value)}
                    rows={3}
                    placeholder={mode === 'inbound' ? 'Paste buyer message here…' : 'Type your message…'}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amazon-orange focus:border-transparent"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend && !sending) {
                        e.preventDefault()
                        handleSend(e as unknown as React.FormEvent)
                      }
                    }}
                  />
                  <button type="submit" disabled={sending || !canSend}
                    className={clsx(
                      'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 shrink-0',
                      mode === 'inbound' || !canUseApi
                        ? 'bg-gray-700 text-white hover:bg-gray-800'
                        : 'bg-amazon-blue text-white hover:bg-blue-700',
                    )}>
                    {sending ? <Loader2 size={14} className="animate-spin" /> : mode === 'inbound' ? <PenLine size={14} /> : <Send size={14} />}
                    {mode === 'inbound' ? 'Log' : canUseApi ? 'Send' : 'Log'}
                  </button>
                </div>

                <p className="text-[10px] text-gray-400">⌘+Enter to submit</p>

                {sendResult && (
                  <div className={clsx('flex items-center gap-2 rounded-lg p-2 text-sm', sendResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
                    {sendResult.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    {sendResult.ok
                      ? sendResult.apiSent === false
                        ? 'Logged (not sent via API — use Seller Central to send).'
                        : mode === 'inbound' ? 'Buyer reply logged.' : 'Message sent via Amazon API and logged.'
                      : sendResult.error}
                  </div>
                )}
              </form>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
