'use client'

import { createContext, useContext, useEffect, useRef } from 'react'
import { useTheme } from './ThemeContext'

interface StockBgState {
  changePercent: number | null
}

const StockBgContext = createContext<StockBgState>({ changePercent: null })
export const useStockBg = () => useContext(StockBgContext)

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number]
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
}

function blend(base: string, target: string, factor: number) {
  const [br, bg, bb] = hexToRgb(base)
  const [tr, tg, tb] = hexToRgb(target)
  return rgbToHex(
    br + (tr - br) * factor,
    bg + (tg - bg) * factor,
    bb + (tb - bb) * factor,
  )
}

function computeBg(changePercent: number, dark: boolean): string {
  const intensity = Math.min(Math.abs(changePercent) / 3, 1)
  const maxBlend = dark ? 0.2 : 0.15
  const factor = intensity * maxBlend

  if (dark) {
    const base = '#0F172A'
    const target = changePercent >= 0 ? '#166534' : '#7F1D1D'
    return blend(base, target, factor)
  }

  const base = '#F3F4F6'
  const target = changePercent >= 0 ? '#22C55E' : '#EF4444'
  return blend(base, target, factor)
}

export function StockBgProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()
  const changeRef = useRef<number | null>(null)

  useEffect(() => {
    let mounted = true

    async function fetchAndApply() {
      try {
        const res = await fetch('/api/stock-quote')
        if (!res.ok) return
        const data = await res.json()
        if (!mounted || data.error) return
        changeRef.current = data.changePercent
        const dark = document.documentElement.classList.contains('dark')
        document.documentElement.style.setProperty(
          '--stock-bg',
          computeBg(data.changePercent, dark),
        )
      } catch {
        // keep last tint
      }
    }

    fetchAndApply()
    const id = setInterval(fetchAndApply, 60_000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  // Re-compute when theme toggles
  useEffect(() => {
    if (changeRef.current == null) return
    const dark = theme === 'dark'
    document.documentElement.style.setProperty(
      '--stock-bg',
      computeBg(changeRef.current, dark),
    )
  }, [theme])

  return (
    <StockBgContext.Provider value={{ changePercent: changeRef.current }}>
      {children}
    </StockBgContext.Provider>
  )
}
