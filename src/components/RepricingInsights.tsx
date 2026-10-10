'use client'
/**
 * Repricing AI Insights — what Claude has learned from the team's approve /
 * reject decisions and comments, proposed strategy-parameter changes (applied
 * only on approval), the effective strategy settings, and the feedback log.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import { Sparkles, Loader2, ArrowLeft, Check, X, RotateCcw, MessageSquare } from 'lucide-react'
import { Pill, Stat, type Tone } from './RepricingFeed'

interface ParamRow {
  param: string; description: string; value: number; defaultValue: number
  overridden: boolean; source: string | null; updatedBy: string | null; updatedAt: string | null
}
interface Proposal {
  id: string; strategy: string; param: string; currentValue: number; proposedValue: number
  rationale: string; status: 'PENDING' | 'APPLIED' | 'DISMISSED'; decidedBy?: string; decidedAt?: string
}
interface Learning {
  id: string; createdAt: string; createdBy: string | null; model: string; decisionsAnalyzed: number
  summary: string
  learnings: { title: string; detail: string; evidence: string; confidence: 'low' | 'medium' | 'high' }[]
  proposals: Proposal[]
}
interface Feedback {
  id: string; asin: string; itemCondition: string; decision: string; rule: string; strategy: string
  currentPrice: number | null; suggestedPrice: number | null; finalPrice: number | null
  note: string | null; aiReply: string | null; decidedBy: string | null; decidedAt: string
}

const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const STRAT_LABEL: Record<string, string> = { CONSERVATIVE: 'Conservative', STANDARD: 'Standard', AGGRESSIVE: 'Aggressive' }
const STRAT_TONE: Record<string, Tone> = { CONSERVATIVE: 'sky', STANDARD: 'blue', AGGRESSIVE: 'red' }
const CONF_TONE: Record<string, Tone> = { low: 'gray', medium: 'amber', high: 'green' }
const fmtVal = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

export default function RepricingInsights() {
  const [strategies, setStrategies] = useState<{ strategy: string; params: ParamRow[] }[]>([])
  const [learnings, setLearnings] = useState<Learning[]>([])
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/repricing/insights')
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed to load')
      setStrategies(j.strategies); setLearnings(j.learnings); setFeedback(j.feedback); setCounts(j.decisionCounts ?? {})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function analyze() {
    setAnalyzing(true)
    try {
      const res = await fetch('/api/repricing/insights/analyze', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Analysis failed')
      toast.success(`Analyzed ${j.learning.decisionsAnalyzed} decisions — ${(j.learning.proposals as Proposal[]).length} proposed change(s)`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analysis failed')
    } finally { setAnalyzing(false) }
  }

  async function act(body: Record<string, string>, key: string, okMsg: string) {
    setBusyId(key)
    try {
      const res = await fetch('/api/repricing/insights/proposal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      toast.success(okMsg)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally { setBusyId(null) }
  }

  const latest = learnings[0]
  const commented = feedback.length
  const totalDecisions = (counts.APPROVED ?? 0) + (counts.REJECTED ?? 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 flex items-center justify-between gap-4">
        <div>
          <a href="/repricing" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-amazon-blue"><ArrowLeft size={12} /> Repricing Feed</a>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><Sparkles size={18} className="text-violet-500" /> Repricing AI Insights</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Claude learns from your approvals, rejections and comments, and proposes strategy changes. Nothing changes until you click Apply.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Stat label="Approved" value={counts.APPROVED ?? 0} tone="green" />
          <Stat label="Rejected" value={counts.REJECTED ?? 0} tone="red" />
          <Stat label="With comments" value={commented} tone="violet" />
          <button onClick={analyze} disabled={analyzing || totalDecisions === 0}
            title={totalDecisions === 0 ? 'Approve or reject some suggestions first' : 'Send the decision log to Claude and get learnings + proposed changes (about a minute)'}
            className="flex items-center gap-1.5 h-9 px-4 rounded-full bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
            {analyzing ? <><Loader2 size={14} className="animate-spin" /> Analyzing… (about a minute)</> : <><Sparkles size={14} /> Analyze our feedback</>}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
        {loading && <div className="flex items-center gap-2 text-gray-400"><Loader2 size={14} className="animate-spin" /> Loading…</div>}

        {/* ── Latest learnings ───────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2">What we've learned</h2>
          {!latest ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-sm text-gray-500">
              No analysis yet. Approve or reject suggestions in the feed — adding a short “why” helps most — then click <b>Analyze our feedback</b>.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10 p-4">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 mb-1.5">
                  <Pill tone="violet">{when(latest.createdAt)}</Pill>
                  <Pill tone="gray">{latest.decisionsAnalyzed} decisions analyzed</Pill>
                  {latest.createdBy && <Pill tone="gray">run by {latest.createdBy}</Pill>}
                </div>
                <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{latest.summary}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {latest.learnings.map((l, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{l.title}</h3>
                      <Pill tone={CONF_TONE[l.confidence]}>{l.confidence} confidence</Pill>
                    </div>
                    <p className="mt-1 text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{l.detail}</p>
                    <p className="mt-1.5 text-[11px] text-gray-500 italic">Evidence: {l.evidence}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── Proposed changes ───────────────────────────────────────── */}
        {latest && (
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2">Proposed strategy changes</h2>
            {latest.proposals.length === 0 ? (
              <p className="text-sm text-gray-500">No parameter changes proposed this time.</p>
            ) : (
              <div className="space-y-2">
                {latest.proposals.map(p => {
                  const up = p.proposedValue > p.currentValue
                  return (
                    <div key={p.id} className={clsx('rounded-lg border p-3 flex flex-wrap items-center gap-3 bg-white dark:bg-gray-900',
                      p.status === 'APPLIED' ? 'border-green-300 dark:border-green-800' : p.status === 'DISMISSED' ? 'border-gray-200 dark:border-gray-700 opacity-60' : 'border-violet-300 dark:border-violet-700')}>
                      <Pill tone={STRAT_TONE[p.strategy] ?? 'gray'}>{STRAT_LABEL[p.strategy] ?? p.strategy}</Pill>
                      <span className="font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{p.param}</span>
                      <Stat label="Now" value={fmtVal(p.currentValue)} />
                      <span className="text-gray-400">→</span>
                      <Stat label="Proposed" value={fmtVal(p.proposedValue)} tone={up ? 'green' : 'red'} />
                      <p className="flex-1 min-w-[260px] text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{p.rationale}</p>
                      {p.status === 'PENDING' ? (
                        <div className="flex gap-1">
                          <button disabled={busyId === p.id} onClick={() => act({ learningId: latest.id, proposalId: p.id, action: 'apply' }, p.id, `Applied: ${STRAT_LABEL[p.strategy]} ${p.param} = ${fmtVal(p.proposedValue)}`)}
                            className="inline-flex items-center gap-1 h-7 px-3 rounded-full bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50">
                            {busyId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Apply
                          </button>
                          <button disabled={busyId === p.id} onClick={() => act({ learningId: latest.id, proposalId: p.id, action: 'dismiss' }, p.id, 'Dismissed')}
                            className="inline-flex items-center gap-1 h-7 px-3 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
                            <X size={12} /> Dismiss
                          </button>
                        </div>
                      ) : (
                        <Pill tone={p.status === 'APPLIED' ? 'green' : 'gray'}>{p.status === 'APPLIED' ? 'Applied' : 'Dismissed'}{p.decidedBy ? ` · ${p.decidedBy}` : ''}{p.decidedAt ? ` · ${when(p.decidedAt)}` : ''}</Pill>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Current strategy settings ──────────────────────────────── */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2">Current strategy settings</h2>
          <div className="grid gap-3 lg:grid-cols-3">
            {strategies.map(s => (
              <div key={s.strategy} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
                <div className="mb-2"><Pill tone={STRAT_TONE[s.strategy] ?? 'gray'}>{STRAT_LABEL[s.strategy] ?? s.strategy}</Pill></div>
                <table className="w-full text-[11px]">
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {s.params.map(r => (
                      <tr key={r.param} title={r.description}>
                        <td className="py-1 pr-2 text-gray-600 dark:text-gray-300">{r.description}</td>
                        <td className="py-1 text-right whitespace-nowrap">
                          {r.overridden ? (
                            <span className="inline-flex items-center gap-1">
                              <Pill tone="violet" mono title={`Changed by ${r.source?.startsWith('learning:') ? 'an applied AI learning' : 'manual change'}${r.updatedBy ? ` · ${r.updatedBy}` : ''}${r.updatedAt ? ` · ${when(r.updatedAt)}` : ''} (default ${fmtVal(r.defaultValue)})`}>{fmtVal(r.value)}</Pill>
                              <button disabled={busyId === `${s.strategy}:${r.param}`} title={`Reset to default (${fmtVal(r.defaultValue)})`}
                                onClick={() => act({ action: 'reset', strategy: s.strategy, param: r.param }, `${s.strategy}:${r.param}`, `Reset to default (${fmtVal(r.defaultValue)})`)}
                                className="text-gray-400 hover:text-red-500"><RotateCcw size={11} /></button>
                            </span>
                          ) : <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">{fmtVal(r.value)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>

        {/* ── Feedback log ───────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2">Your feedback &amp; Claude&apos;s replies</h2>
          {feedback.length === 0 ? (
            <p className="text-sm text-gray-500">No comments yet — add a “why” when you approve or reject in the feed.</p>
          ) : (
            <div className="space-y-2">
              {feedback.map(f => (
                <div key={f.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={f.decision === 'APPROVED' ? 'green' : 'red'}>{f.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</Pill>
                    <span className="font-mono text-xs font-bold text-amazon-blue">{f.asin}</span>
                    <Pill tone={f.itemCondition === 'New' ? 'violet' : 'amber'}>{f.itemCondition}</Pill>
                    <Pill tone="gray">{f.rule}</Pill>
                    <Pill tone={STRAT_TONE[f.strategy] ?? 'gray'}>{STRAT_LABEL[f.strategy] ?? f.strategy}</Pill>
                    <Pill tone="gray">{money(f.currentPrice)} → {money(f.finalPrice ?? f.suggestedPrice)}</Pill>
                    <span className="ml-auto text-[11px] text-gray-400">{f.decidedBy} · {when(f.decidedAt)}</span>
                  </div>
                  <p className="mt-2 flex gap-1.5 text-sm text-gray-800 dark:text-gray-200"><MessageSquare size={14} className="mt-0.5 shrink-0 text-gray-400" /> {f.note}</p>
                  {f.aiReply && (
                    <p className="mt-1.5 flex gap-1.5 rounded-md bg-violet-50 dark:bg-violet-900/20 px-2 py-1.5 text-xs text-violet-900 dark:text-violet-200">
                      <Sparkles size={13} className="mt-0.5 shrink-0 text-violet-500" /> {f.aiReply}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
