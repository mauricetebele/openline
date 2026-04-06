import { useState, useCallback } from 'react'
import { apiFetchRaw } from '@/lib/api'
import type { RateEvent, DoneEvent, SSEEvent } from '@/lib/types'

export function useRateShop() {
  const [rates, setRates] = useState<Record<string, RateEvent>>({})
  const [done, setDone] = useState<DoneEvent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rateShop = useCallback(
    async (orderIds: string[], accountId: string, shipDate?: string) => {
      setRates({})
      setDone(null)
      setError(null)
      setLoading(true)

      try {
        const res = await apiFetchRaw('/api/orders/rate-shop-applied-presets', {
          method: 'POST',
          body: JSON.stringify({ orderIds, accountId, shipDate }),
        })

        const reader = res.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done: streamDone, value } = await reader.read()
          if (streamDone) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const json = line.slice(6).trim()
            if (!json) continue

            try {
              const event = JSON.parse(json) as SSEEvent
              if (event.type === 'rate') {
                setRates((prev) => ({ ...prev, [event.orderId]: event }))
              } else if (event.type === 'done') {
                setDone(event)
              } else if (event.type === 'error') {
                setError(event.error)
              }
            } catch {
              // skip unparseable lines
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Rate shop failed')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const reset = useCallback(() => {
    setRates({})
    setDone(null)
    setError(null)
  }, [])

  return { rates, done, loading, error, rateShop, reset }
}
