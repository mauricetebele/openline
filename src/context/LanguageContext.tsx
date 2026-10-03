'use client'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { ES } from '@/i18n/es'

// 'en' = English, 'es' = Spanish (full UI translation),
// 'hybrid' = English UI with a Spanish translation popup on 1s hover.
type Lang = 'en' | 'es' | 'hybrid'

interface LanguageContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  toggle: () => void
  /** Translate a single string (EN source → ES) when in Spanish mode. */
  t: (text: string) => string
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en', setLang: () => {}, toggle: () => {}, t: (s) => s,
})

// ─── Runtime DOM auto-translation ───────────────────────────────────────────
// In Spanish mode we walk the live DOM and swap any text node / placeholder /
// title whose (trimmed) English text appears in the ES dictionary. A
// MutationObserver re-applies it as React re-renders. Strings not yet in the
// dictionary simply stay English (graceful fallback). Add data-no-translate on
// any element whose text must never be translated.

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'INPUT'])
const translatedValues = new Set(Object.values(ES))

function lookup(key: string): string | null {
  const hit = ES[key]
  if (!hit || hit === key) return null
  return hit
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')
  const [mounted, setMounted] = useState(false)

  // Undo logs so we can restore English instantly when toggling back.
  const textEdits = useRef<Array<[Text, string]>>([])
  const attrEdits = useRef<Array<[Element, string, string]>>([])
  const observerRef = useRef<MutationObserver | null>(null)

  useEffect(() => {
    setMounted(true)
    try {
      const stored = localStorage.getItem('app-lang') as Lang | null
      if (stored === 'es' || stored === 'en' || stored === 'hybrid') setLangState(stored)
    } catch { /* SSR safety */ }
  }, [])

  useEffect(() => {
    if (!mounted) return
    try { document.documentElement.lang = lang === 'es' ? 'es' : 'en' } catch { /* noop */ }

    if (lang === 'es') {
      translateTree(document.body)
      const obs = new MutationObserver(muts => {
        for (const m of muts) {
          if (m.type === 'characterData' && m.target.nodeType === Node.TEXT_NODE) {
            translateTextNode(m.target as Text)
          } else {
            m.addedNodes.forEach(n => {
              if (n.nodeType === Node.TEXT_NODE) translateTextNode(n as Text)
              else if (n.nodeType === Node.ELEMENT_NODE) translateTree(n as Element)
            })
          }
        }
      })
      obs.observe(document.body, { childList: true, subtree: true, characterData: true })
      observerRef.current = obs
      return () => { obs.disconnect(); observerRef.current = null }
    }

    // Leaving Spanish: make sure any swapped text is back to English.
    observerRef.current?.disconnect()
    observerRef.current = null
    restoreAll()

    // Hybrid: English UI + Spanish translation popup after 1s hover.
    if (lang === 'hybrid') return setupHybridHover()
  }, [lang, mounted])

  function translateTextNode(node: Text) {
    const raw = node.nodeValue
    if (!raw) return
    const key = raw.trim()
    if (!key || translatedValues.has(key)) return
    const es = lookup(key)
    if (!es) return
    textEdits.current.push([node, raw])
    node.nodeValue = raw.replace(key, es)
  }

  function translateAttr(el: Element, attr: string) {
    const raw = el.getAttribute(attr)
    if (!raw) return
    const key = raw.trim()
    if (!key || translatedValues.has(key)) return
    const es = lookup(key)
    if (!es) return
    attrEdits.current.push([el, attr, raw])
    el.setAttribute(attr, raw.replace(key, es))
  }

  function translateTree(root: Element | HTMLElement) {
    if (root instanceof Element && root.closest('[data-no-translate]')) return
    // Text nodes
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement
        if (!p) return NodeFilter.FILTER_REJECT
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT
        if (p.isContentEditable) return NodeFilter.FILTER_REJECT
        if (p.closest('[data-no-translate]')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    nodes.forEach(translateTextNode)
    // Placeholders + titles
    const scope = root instanceof Element ? root : document.body
    scope.querySelectorAll?.('[placeholder]').forEach(el => {
      if (!el.closest('[data-no-translate]')) translateAttr(el, 'placeholder')
    })
    scope.querySelectorAll?.('[title]').forEach(el => {
      if (!el.closest('[data-no-translate]')) translateAttr(el, 'title')
    })
    if (root instanceof Element && root.hasAttribute('placeholder')) translateAttr(root, 'placeholder')
    if (root instanceof Element && root.hasAttribute('title')) translateAttr(root, 'title')
  }

  function restoreAll() {
    for (const [node, orig] of textEdits.current) {
      try { node.nodeValue = orig } catch { /* node gone */ }
    }
    for (const [el, attr, orig] of attrEdits.current) {
      try { el.setAttribute(attr, orig) } catch { /* el gone */ }
    }
    textEdits.current = []
    attrEdits.current = []
  }

  // ── Hybrid mode: English UI, Spanish popup after the pointer rests 1s ──────
  function hybridLookup(el: Element): string | null {
    if (el.closest('[data-no-translate]')) return null
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const v = el.getAttribute(attr)?.trim()
      if (v) { const es = lookup(v); if (es) return es }
    }
    const txt = (el.textContent ?? '').trim()
    if (txt && txt.length <= 120) { const es = lookup(txt); if (es) return es }
    return null
  }

  function setupHybridHover(): () => void {
    const tip = document.createElement('div')
    tip.setAttribute('data-no-translate', '')
    tip.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'max-width:320px', 'padding:6px 10px',
      'border-radius:8px', 'background:#1e293b', 'color:#fff', 'font-size:12px',
      'line-height:1.35', 'box-shadow:0 6px 20px rgba(0,0,0,.35)', 'pointer-events:none',
      'opacity:0', 'transition:opacity .12s ease', 'font-family:inherit', 'white-space:normal',
    ].join(';')
    document.body.appendChild(tip)

    let timer = 0
    let x = 0, y = 0
    const hide = () => { if (timer) { clearTimeout(timer); timer = 0 } tip.style.opacity = '0' }

    const onOver = (e: MouseEvent) => {
      const el = e.target as Element | null
      x = e.clientX; y = e.clientY
      if (timer) clearTimeout(timer)
      tip.style.opacity = '0'
      if (!el || !(el instanceof Element) || el === tip) return
      const tag = el.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE') return
      timer = window.setTimeout(() => {
        const es = hybridLookup(el)
        if (!es) return
        tip.textContent = `🇪🇸 ${es}`
        let left = x + 14, top = y + 18
        const w = Math.min(320, tip.offsetWidth || 240)
        const h = tip.offsetHeight || 30
        if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8
        if (top + h > window.innerHeight - 8) top = y - h - 10
        tip.style.left = `${Math.max(8, left)}px`
        tip.style.top = `${Math.max(8, top)}px`
        tip.style.opacity = '1'
      }, 1000)
    }

    document.addEventListener('mouseover', onOver, true)
    document.addEventListener('mouseout', hide, true)
    window.addEventListener('scroll', hide, true)
    return () => {
      hide()
      document.removeEventListener('mouseover', onOver, true)
      document.removeEventListener('mouseout', hide, true)
      window.removeEventListener('scroll', hide, true)
      tip.remove()
    }
  }

  function setLang(l: Lang) {
    setLangState(l)
    try { localStorage.setItem('app-lang', l) } catch { /* SSR safety */ }
  }
  // Cycle EN → ES → Hybrid → EN.
  function toggle() { setLang(lang === 'en' ? 'es' : lang === 'es' ? 'hybrid' : 'en') }
  function t(text: string): string {
    if (lang !== 'es') return text
    return ES[text] ?? text
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggle, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}
