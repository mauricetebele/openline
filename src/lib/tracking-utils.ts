/**
 * Client-safe carrier detection and tracking URL helpers.
 * Re-exports pure functions that don't depend on server-side modules.
 */

export type Carrier = 'UPS' | 'USPS' | 'FEDEX' | 'AMZL' | 'UNKNOWN'

/** Detect likely carrier from tracking number format */
export function detectCarrier(tracking: string): Carrier {
  const t = tracking.trim().toUpperCase()

  if (/^TBA\d{12,}$/.test(t)) return 'AMZL'
  if (t.startsWith('1Z') && t.length === 18) return 'UPS'
  if (/^\d{9}$/.test(t) || /^\d{18}$/.test(t)) return 'UPS'
  if (/^9[2-5]\d{18,}$/.test(t) || /^[0-9]{20,22}$/.test(t)) return 'USPS'
  if (/^\d{12}$/.test(t) || /^\d{15}$/.test(t)) return 'FEDEX'

  return 'UNKNOWN'
}

export function trackingUrl(tracking: string): string {
  const carrier = detectCarrier(tracking)
  if (carrier === 'UPS')   return `https://www.ups.com/track?tracknum=${tracking}`
  if (carrier === 'USPS')  return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${tracking}`
  if (carrier === 'FEDEX') return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`
  if (carrier === 'AMZL')  return `https://www.amazon.com/progress-tracker/package/ref=ppx_yo_dt_b_track_package?_encoding=UTF8&itemId=&orderId=${tracking}`
  return `https://www.google.com/search?q=${encodeURIComponent(tracking + ' tracking')}`
}
