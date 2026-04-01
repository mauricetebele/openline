'use client'

import { useState } from 'react'

export default function DebugRatesPage() {
  const [amazonOrderId, setAmazonOrderId] = useState('')
  const [shipDate, setShipDate] = useState(new Date().toISOString().slice(0, 10))
  const [weightLb, setWeightLb] = useState('1')
  const [lengthIn, setLengthIn] = useState('1')
  const [widthIn, setWidthIn] = useState('1')
  const [heightIn, setHeightIn] = useState('1')
  const [confirmation, setConfirmation] = useState('none')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const res = await fetch('/api/debug-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amazonOrderId: amazonOrderId.trim(),
          shipDate,
          weightLb: parseFloat(weightLb) || 1,
          lengthIn: parseFloat(lengthIn) || 1,
          widthIn: parseFloat(widthIn) || 1,
          heightIn: parseFloat(heightIn) || 1,
          confirmation,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`)
      } else {
        setResult(data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Debug ShipStation V2 Rates</h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        Builds the exact V2 rates payload for an Amazon order, sends it to ShipStation, and shows the raw request &amp; response.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Amazon Order ID *
          <input
            value={amazonOrderId}
            onChange={e => setAmazonOrderId(e.target.value)}
            required
            placeholder="xxx-xxxxxxx-xxxxxxx"
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Ship Date
          <input type="date" value={shipDate} onChange={e => setShipDate(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Weight (lb)
          <input type="number" step="0.01" min="0.01" value={weightLb} onChange={e => setWeightLb(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Length (in)
          <input type="number" step="0.1" min="0.1" value={lengthIn} onChange={e => setLengthIn(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Width (in)
          <input type="number" step="0.1" min="0.1" value={widthIn} onChange={e => setWidthIn(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Height (in)
          <input type="number" step="0.1" min="0.1" value={heightIn} onChange={e => setHeightIn(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          Delivery Confirmation
          <select value={confirmation} onChange={e => setConfirmation(e.target.value)} style={inputStyle}>
            <option value="none">None</option>
            <option value="delivery">Delivery</option>
            <option value="signature">Signature</option>
            <option value="adult_signature">Adult Signature</option>
            <option value="direct_signature">Direct Signature</option>
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            type="submit"
            disabled={loading || !amazonOrderId.trim()}
            style={{
              padding: '8px 20px',
              background: loading ? '#999' : '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: loading ? 'wait' : 'pointer',
              fontWeight: 600,
              fontSize: 14,
              width: '100%',
            }}
          >
            {loading ? 'Fetching...' : 'Get Rates'}
          </button>
        </div>
      </form>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: 12, marginBottom: 16, color: '#b91c1c', fontSize: 14 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Order Info</h2>
            <pre style={preStyle}>{JSON.stringify(result.order, null, 2)}</pre>

            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, marginTop: 16 }}>Carrier ID Used</h2>
            <pre style={preStyle}>{result.carrierIdUsed as string}</pre>

            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, marginTop: 16 }}>Request Payload (sent to ShipStation)</h2>
            <pre style={preStyle}>{JSON.stringify(result.requestPayload, null, 2)}</pre>
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Raw API Response</h2>
            <pre style={{ ...preStyle, maxHeight: '80vh' }}>{JSON.stringify(result.response, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
}

const preStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 12,
  fontSize: 12,
  overflow: 'auto',
  maxHeight: 500,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}
