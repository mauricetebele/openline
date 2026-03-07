'use client'
import { useState, useEffect, useRef } from 'react'
import { AlertCircle, X, Package, Hash, Clock, ShoppingCart, Search, Printer, ArrowRightLeft, Tag } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface HistoryEvent {
  id:            string
  eventType:     string
  createdAt:     string
  notes:         string | null
  receipt:       { id: string; receivedAt: string } | null
  purchaseOrder: { id: string; poNumber: number; vendor: { name: string } } | null
  order:         { id: string; olmNumber: number | null; amazonOrderId: string; orderSource: string; shipToName: string | null; shipToCity: string | null; shipToState: string | null; orderTotal: string | null; currency: string | null; label: { trackingNumber: string; carrier: string | null; serviceCode: string | null; shipmentCost: string | null } | null } | null
  location:      { name: string; warehouse: { name: string } } | null
  fromLocation:  { name: string; warehouse: { name: string } } | null
  fromProduct:   { id: string; description: string; sku: string } | null
  toProduct:     { id: string; description: string; sku: string } | null
}

interface LookupSerial {
  id:           string
  serialNumber: string
  status:       string
  binLocation:  string | null
  product:      { description: string; sku: string }
  grade:        { id: string; grade: string } | null
  location:     { name: string; warehouse: { name: string } }
  history: HistoryEvent[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'In Stock',
  SOLD:     'Sold',
  RETURNED: 'Returned',
  DAMAGED:  'Damaged',
}
const STATUS_COLOR: Record<string, string> = {
  IN_STOCK: 'bg-green-100 text-green-700',
  SOLD:     'bg-gray-100 text-gray-500',
  RETURNED: 'bg-blue-100 text-blue-700',
  DAMAGED:  'bg-red-100 text-red-700',
}
const EVENT_LABEL: Record<string, string> = {
  PO_RECEIPT:     'PO Receipt',
  LOCATION_MOVE:  'Location Move',
  SKU_CONVERSION: 'SKU Conversion',
  SALE:           'Sale',
  ASSIGNED:       'Assigned',
  UNASSIGNED:     'Unassigned',
  BIN_ASSIGNED:   'Bin Location Assigned',
  NOTE_ADDED:     'Serial Note Populated',
  MANUAL_ADD:     'Manual Inventory Add',
  MANUAL_REMOVE:  'Manual Inventory Remove',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SNLookupModal({ onClose, initialQuery }: { onClose: () => void; initialQuery?: string }) {
  const [query,    setQuery]    = useState(initialQuery ?? '')
  const [result,   setResult]   = useState<LookupSerial | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState('')
  const [printing,  setPrinting]  = useState(false)
  const [printErr,  setPrintErr]  = useState('')

  // DYMO printer setup
  const DYMO_API = 'https://127.0.0.1:41951/DYMO/DLS/Printing'
  const [dymoStatus, setDymoStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [dymoErr, setDymoErr]       = useState('')
  const [printers, setPrinters]     = useState<string[]>([])
  const [selectedPrinter, setSelectedPrinter] = useState('')
  const [detectedLabel, setDetectedLabel]     = useState<string | null>(null)
  const [dymoLabelNames, setDymoLabelNames]  = useState<string[]>([])

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const saved = localStorage.getItem('dymo_printer')
    if (saved) setSelectedPrinter(saved)
  }, [])

  // Auto-detect DYMO printers on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { detectDymo() }, [])

  // Auto-search if initialQuery provided
  useEffect(() => {
    if (initialQuery?.trim()) {
      handleSearch(initialQuery.trim())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function detectDymo() {
    setDymoStatus('loading')
    setDymoErr('')
    try {
      const res = await fetch(`${DYMO_API}/GetPrinters`)
      if (!res.ok) throw new Error('Cannot reach DYMO Connect')
      const xml = await res.text()
      const matches = [...xml.matchAll(/<LabelWriterPrinter>[\s\S]*?<Name>(.*?)<\/Name>[\s\S]*?<IsConnected>True<\/IsConnected>/g)]
      const names = matches.map(m => m[1])
      setPrinters(names)
      if (names.length === 0) throw new Error('No connected DYMO printers found')
      const saved = localStorage.getItem('dymo_printer')
      const pick = (saved && names.includes(saved)) ? saved : names[0]
      setSelectedPrinter(pick)
      localStorage.setItem('dymo_printer', pick)

      // Try to auto-detect loaded label via 550 API
      try {
        const infoRes = await fetch(
          `${DYMO_API}/GetConsumableInfoIn550Printer?printerName=${encodeURIComponent(pick)}`,
        )
        if (infoRes.ok) {
          const infoText = await infoRes.text()
          try {
            const info = JSON.parse(infoText)
            if (info.sku) setDetectedLabel(info.sku)
          } catch {
            const skuMatch = infoText.match(/<Name>([^<]+)<\/Name>/)
              ?? infoText.match(/<LabelSize>([^<]+)<\/LabelSize>/)
              ?? infoText.match(/<Sku>([^<]+)<\/Sku>/)
            if (skuMatch) setDetectedLabel(skuMatch[1])
          }
        }
      } catch { /* not a 550 — ignore */ }

      // Discover available label names from the DYMO framework JS
      try {
        const fwUrls = [
          `${DYMO_API}/js/DYMO.Label.Framework.latest.js`,
          `${DYMO_API}/js/dymo.connect.framework.js`,
        ]
        for (const url of fwUrls) {
          try {
            const fwRes = await fetch(url)
            if (!fwRes.ok) continue
            const js = await fwRes.text()
            const nameMatches = js.match(/["']([^"']*30334[^"']*?)["']/gi) ?? []
            const found = [...new Set(nameMatches.map(m => m.slice(1, -1)))]
            if (found.length > 0) {
              console.log('[DYMO] Found 30334 label names in framework:', found)
              setDymoLabelNames(found)
              break
            }
          } catch { /* try next URL */ }
        }
      } catch { /* framework not available */ }

      setDymoStatus('ready')
    } catch (e) {
      setDymoErr(e instanceof Error ? e.message : 'DYMO detection failed')
      setDymoStatus('error')
    }
  }

  function handlePrinterChange(printer: string) {
    setSelectedPrinter(printer)
    localStorage.setItem('dymo_printer', printer)
  }

  function escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  async function printLabel() {
    if (!result || !selectedPrinter) return
    setPrinting(true)
    setPrintErr('')
    try {
      const serial = escapeXml(result.serialNumber)
      const sku    = escapeXml(result.product.sku)
      const grade  = result.grade ? escapeXml(result.grade.grade) : ''
      const topLine = grade ? `${sku}  [${grade}]` : sku

      const labelNames = [
        ...dymoLabelNames,
        'MediumMultipurpose30334',
        'Medium Multipurpose Labels',
        '30334 Medium Multipurpose',
        '30334 Medium',
        '30334 Multipurpose',
        '30334 2-1/4 in x 1-1/4 in',
        'Medium30334',
        'Multipurpose30334',
        '30334 LW',
        'LW30334',
      ]
      const uniqueNames = [...new Set(labelNames)]
      const saved = localStorage.getItem('dymo_paper')
      if (saved) {
        const idx = uniqueNames.indexOf(saved)
        if (idx > 0) { uniqueNames.splice(idx, 1); uniqueNames.unshift(saved) }
        else if (idx === -1) uniqueNames.unshift(saved)
      }

      const brush = (a: string, r: string, g: string, b: string) =>
        `<SolidColorBrush><Color A="${a}" R="${r}" G="${g}" B="${b}"></Color></SolidColorBrush>`
      const stdBrushes = `<Brushes>
<BackgroundBrush>${brush('0','1','1','1')}</BackgroundBrush>
<BorderBrush>${brush('1','0','0','0')}</BorderBrush>
<StrokeBrush>${brush('1','0','0','0')}</StrokeBrush>
<FillBrush>${brush('0','0','0','0')}</FillBrush>
</Brushes>`
      const stdProps = `<Rotation>Rotation0</Rotation>
<OutlineThickness>1</OutlineThickness>
<IsOutlined>False</IsOutlined>
<BorderStyle>SolidLine</BorderStyle>
<Margin><DYMOThickness Left="0" Top="0" Right="0" Bottom="0" /></Margin>`

      for (const labelName of uniqueNames) {
        const labelXml = `<?xml version="1.0" encoding="utf-8"?>
<DesktopLabel Version="1">
<DYMOLabel Version="3">
<Description>DYMO Label</Description>
<Orientation>Landscape</Orientation>
<LabelName>${labelName}</LabelName>
<InitialLength>0</InitialLength>
<BorderStyle>SolidLine</BorderStyle>
<DYMORect>
<DYMOPoint><X>0.1</X><Y>0.06</Y></DYMOPoint>
<Size><Width>2.05</Width><Height>1.13</Height></Size>
</DYMORect>
<BorderColor>${brush('1','0','0','0')}</BorderColor>
<BorderThickness>0</BorderThickness>
<Show_Border>False</Show_Border>
<DynamicLayoutManager>
<RotationBehavior>ClearObjects</RotationBehavior>
<LabelObjects>
<TextObject>
<Name>SKU</Name>
${stdBrushes}
${stdProps}
<HorizontalAlignment>Left</HorizontalAlignment>
<VerticalAlignment>Middle</VerticalAlignment>
<FitMode>ShrinkToFit</FitMode>
<IsVertical>False</IsVertical>
<FormattedText>
<FitMode>ShrinkToFit</FitMode>
<HorizontalAlignment>Left</HorizontalAlignment>
<VerticalAlignment>Middle</VerticalAlignment>
<IsVertical>False</IsVertical>
<LineTextSpan>
<TextSpan>
<Text>${topLine}</Text>
<FontInfo>
<FontName>Arial</FontName>
<FontSize>10</FontSize>
<IsBold>True</IsBold>
<IsItalic>False</IsItalic>
<IsUnderline>False</IsUnderline>
<FontBrush>${brush('1','0','0','0')}</FontBrush>
</FontInfo>
</TextSpan>
</LineTextSpan>
</FormattedText>
<ObjectLayout>
<DYMOPoint><X>0.12</X><Y>0.07</Y></DYMOPoint>
<Size><Width>1.9</Width><Height>0.3</Height></Size>
</ObjectLayout>
</TextObject>
<BarcodeObject>
<Name>BARCODE</Name>
${stdBrushes}
${stdProps}
<BarcodeFormat>Code128Auto</BarcodeFormat>
<Data>
<DataString>${serial}</DataString>
</Data>
<HorizontalAlignment>Center</HorizontalAlignment>
<VerticalAlignment>Middle</VerticalAlignment>
<Size>Medium</Size>
<TextPosition>Bottom</TextPosition>
<ObjectLayout>
<DYMOPoint><X>0.12</X><Y>0.4</Y></DYMOPoint>
<Size><Width>1.9</Width><Height>0.65</Height></Size>
</ObjectLayout>
</BarcodeObject>
</LabelObjects>
</DynamicLayoutManager>
</DYMOLabel>
<LabelApplication>Blank</LabelApplication>
<DataTable><Columns></Columns><Rows></Rows></DataTable>
</DesktopLabel>`

        console.log(`[DYMO] Trying LabelName="${labelName}" (${uniqueNames.indexOf(labelName) + 1}/${uniqueNames.length})`)

        const printRes = await fetch(`${DYMO_API}/PrintLabel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            printerName: selectedPrinter,
            printParamsXml: '',
            labelXml,
            labelSetXml: '',
          }),
        })
        if (printRes.ok) {
          console.log(`[DYMO] Success with LabelName="${labelName}"`)
          localStorage.setItem('dymo_paper', labelName)
          return
        }
        const errText = await printRes.text()
        console.log(`[DYMO] Error:`, errText)
        if (/labelname|not available|paper/i.test(errText)) continue
        throw new Error(errText)
      }
      throw new Error(`No matching label name found. Open DYMO Connect → select your 30334 label → note the exact label name shown. Tried: ${uniqueNames.join(', ')}`)
    } catch (e: unknown) {
      setPrintErr(e instanceof Error ? e.message : 'Print failed')
    } finally {
      setPrinting(false)
    }
  }

  async function handleSearch(sn?: string) {
    const val = (sn ?? query).trim()
    if (!val) return
    setLoading(true)
    setErr('')
    setResult(null)
    try {
      const res  = await fetch(`/api/serials/lookup?sn=${encodeURIComponent(val)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Lookup failed')
      setResult(data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Search size={15} className="text-amazon-blue" />
            <h2 className="text-sm font-semibold text-gray-900">Serial Number Lookup</h2>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-5 py-4 border-b shrink-0">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setErr(''); setResult(null) }}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
              placeholder="Enter or scan a serial number…"
              className="flex-1 h-10 rounded-md border border-gray-300 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
            <button
              type="button"
              onClick={() => handleSearch()}
              disabled={loading || !query.trim()}
              className="h-10 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Search size={14} />
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!result && !err && !loading && (
            <div className="py-12 text-center">
              <Hash size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">Enter a serial number to view its history</p>
            </div>
          )}

          {err && (
            <div className="py-10 text-center">
              <AlertCircle size={28} className="mx-auto text-red-300 mb-2" />
              <p className="text-sm font-medium text-red-600">{err}</p>
              <button type="button" onClick={() => { setErr(''); inputRef.current?.focus() }}
                className="mt-3 text-xs text-amazon-blue hover:underline">
                Try another serial number
              </button>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* Serial summary card */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold font-mono text-gray-900">{result.serialNumber}</p>
                    <p className="text-sm font-medium text-gray-700 mt-0.5">{result.product.description}</p>
                    <p className="text-xs font-mono text-gray-400">{result.product.sku}</p>
                  </div>
                  <span className={`shrink-0 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold mt-0.5 ${STATUS_COLOR[result.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABEL[result.status] ?? result.status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500 pt-1 border-t border-gray-200">
                  <Package size={11} className="shrink-0" />
                  Current location:
                  <span className="font-medium text-gray-700">
                    {result.location.warehouse.name} / {result.location.name}
                  </span>
                </div>
                <p className="text-xs text-gray-500 pl-0.5">
                  Bin: <span className="font-mono font-medium text-gray-700">{result.binLocation ?? '—'}</span>
                </p>
              </div>

              {/* History timeline */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-3">
                  <Clock size={11} /> History ({result.history.length} event{result.history.length !== 1 ? 's' : ''})
                </p>

                {result.history.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No history recorded for this serial number</p>
                ) : (
                  <div className="space-y-2">
                    {result.history.map((event, ei) => (
                      <div key={event.id} className="relative pl-5">
                        {ei < result.history.length - 1 && (
                          <span className="absolute left-[8px] top-5 bottom-0 w-px bg-gray-200" />
                        )}
                        <span className="absolute left-0.5 top-1.5 w-3.5 h-3.5 rounded-full bg-white border-2 border-amazon-blue flex items-center justify-center">
                          <span className="w-1.5 h-1.5 rounded-full bg-amazon-blue" />
                        </span>

                        <div className="bg-white rounded-md border border-gray-200 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            {event.eventType === 'LOCATION_MOVE' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium">
                                <ArrowRightLeft size={10} />
                                Location Move
                              </span>
                            ) : event.eventType === 'SKU_CONVERSION' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 text-xs font-medium">
                                <Tag size={10} />
                                SKU Conversion
                              </span>
                            ) : event.eventType === 'SALE' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 text-xs font-medium">
                                <ShoppingCart size={10} />
                                Sale
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-xs font-medium">
                                {EVENT_LABEL[event.eventType] ?? event.eventType}
                              </span>
                            )}
                            <span className="text-xs text-gray-400 shrink-0">
                              {new Date(event.createdAt).toLocaleString('en-US', {
                                month: 'short', day: 'numeric', year: 'numeric',
                                hour: 'numeric', minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="space-y-0.5 text-xs text-gray-600">
                            {event.eventType === 'LOCATION_MOVE' ? (
                              <>
                                {event.fromLocation && (
                                  <p>
                                    <span className="text-gray-400">From:</span>{' '}
                                    <span className="font-medium text-gray-800">
                                      {event.fromLocation.warehouse.name} / {event.fromLocation.name}
                                    </span>
                                  </p>
                                )}
                                {event.location && (
                                  <p>
                                    <span className="text-gray-400">To:</span>{' '}
                                    <span className="font-medium text-gray-800">
                                      {event.location.warehouse.name} / {event.location.name}
                                    </span>
                                  </p>
                                )}
                              </>
                            ) : event.eventType === 'SKU_CONVERSION' ? (
                              <>
                                {event.fromProduct && (
                                  <p>
                                    <span className="text-gray-400">From:</span>{' '}
                                    <span className="font-mono font-medium text-gray-800">{event.fromProduct.sku}</span>
                                    <span className="text-gray-400"> · {event.fromProduct.description}</span>
                                  </p>
                                )}
                                {event.toProduct && (
                                  <p>
                                    <span className="text-gray-400">To:</span>{' '}
                                    <span className="font-mono font-medium text-gray-800">{event.toProduct.sku}</span>
                                    <span className="text-gray-400"> · {event.toProduct.description}</span>
                                  </p>
                                )}
                              </>
                            ) : event.eventType === 'SALE' ? (
                              <>
                                {event.order && (
                                  <>
                                    {event.order.olmNumber && (
                                      <p>
                                        <span className="text-gray-400">OLM #:</span>{' '}
                                        <span className="font-semibold font-mono text-gray-800">OLM-{event.order.olmNumber}</span>
                                      </p>
                                    )}
                                    <p>
                                      <span className="text-gray-400">{event.order.orderSource === 'backmarket' ? 'BackMarket #:' : 'Amazon #:'}</span>{' '}
                                      <span className="font-semibold font-mono text-gray-800">{event.order.amazonOrderId}</span>
                                    </p>
                                    {event.order.shipToName && (
                                      <p>
                                        <span className="text-gray-400">Buyer:</span>{' '}
                                        <span className="font-medium text-gray-800">
                                          {event.order.shipToName}
                                          {event.order.shipToCity && event.order.shipToState
                                            ? ` · ${event.order.shipToCity}, ${event.order.shipToState}`
                                            : ''}
                                        </span>
                                      </p>
                                    )}
                                    {event.order.label && (
                                      <>
                                        <p>
                                          <span className="text-gray-400">Tracking:</span>{' '}
                                          <span className="font-mono font-medium text-gray-800">{event.order.label.trackingNumber}</span>
                                        </p>
                                        {(event.order.label.carrier || event.order.label.serviceCode) && (
                                          <p>
                                            <span className="text-gray-400">Carrier:</span>{' '}
                                            <span className="font-medium text-gray-800">
                                              {[event.order.label.carrier, event.order.label.serviceCode].filter(Boolean).join(' · ')}
                                            </span>
                                          </p>
                                        )}
                                        {event.order.label.shipmentCost && (
                                          <p>
                                            <span className="text-gray-400">Shipping Cost:</span>{' '}
                                            <span className="font-medium text-gray-800">${Number(event.order.label.shipmentCost).toFixed(2)}</span>
                                          </p>
                                        )}
                                      </>
                                    )}
                                  </>
                                )}
                                {event.location && (
                                  <p>
                                    <span className="text-gray-400">Shipped from:</span>{' '}
                                    <span className="font-medium text-gray-800">
                                      {event.location.warehouse.name} / {event.location.name}
                                    </span>
                                  </p>
                                )}
                              </>
                            ) : (event.eventType === 'ASSIGNED' || event.eventType === 'UNASSIGNED') && event.order ? (
                              <>
                                {event.order.olmNumber && (
                                  <p>
                                    <span className="text-gray-400">OLM #:</span>{' '}
                                    <span className="font-semibold font-mono text-gray-800">OLM-{event.order.olmNumber}</span>
                                  </p>
                                )}
                                <p>
                                  <span className="text-gray-400">{event.order.orderSource === 'backmarket' ? 'BackMarket #:' : 'Amazon #:'}</span>{' '}
                                  <span className="font-semibold font-mono text-gray-800">{event.order.amazonOrderId}</span>
                                </p>
                                {event.order.shipToName && (
                                  <p>
                                    <span className="text-gray-400">Buyer:</span>{' '}
                                    <span className="font-medium text-gray-800">{event.order.shipToName}</span>
                                  </p>
                                )}
                              </>
                            ) : (
                              <>
                                {event.purchaseOrder && (
                                  <p>
                                    <span className="text-gray-400">PO:</span>{' '}
                                    <span className="font-semibold text-gray-800">#{event.purchaseOrder.poNumber}</span>
                                    {' · '}{event.purchaseOrder.vendor.name}
                                  </p>
                                )}
                                {event.receipt && (
                                  <p>
                                    <span className="text-gray-400">Received:</span>{' '}
                                    <span className="font-medium text-gray-800">
                                      {new Date(event.receipt.receivedAt).toLocaleString('en-US', {
                                        month: 'short', day: 'numeric', year: 'numeric',
                                        hour: 'numeric', minute: '2-digit',
                                      })}
                                    </span>
                                  </p>
                                )}
                                {event.location && (
                                  <p>
                                    <span className="text-gray-400">Location:</span>{' '}
                                    <span className="font-medium text-gray-800">
                                      {event.location.warehouse.name} / {event.location.name}
                                    </span>
                                  </p>
                                )}
                                {event.notes && !event.purchaseOrder && (
                                  <p className="text-gray-500 italic">{event.notes}</p>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t shrink-0 space-y-2">
          {/* DYMO Printer Setup */}
          {result && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">DYMO Printer</p>
                {dymoStatus === 'error' && (
                  <button onClick={detectDymo} className="text-[10px] text-blue-600 hover:underline">Retry</button>
                )}
              </div>
              {dymoStatus === 'loading' && (
                <p className="text-xs text-gray-500">Detecting printers…</p>
              )}
              {dymoStatus === 'error' && (
                <p className="text-xs text-red-600">{dymoErr}</p>
              )}
              {dymoStatus === 'ready' && (
                <div className="space-y-1">
                  <select value={selectedPrinter} onChange={e => handlePrinterChange(e.target.value)}
                    className="h-7 w-full rounded border border-gray-300 text-xs px-2 bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue">
                    {printers.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {detectedLabel && (
                    <p className="text-[10px] text-gray-500">Label: {detectedLabel}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {printErr && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{printErr}</span>
            </div>
          )}
          {/* Label preview */}
          {result && (
            <div className="flex items-start gap-4">
              <div className="border border-gray-300 rounded-md bg-white p-3 shadow-sm" style={{ width: 220, minHeight: 90 }}>
                <p className="text-[10px] font-bold text-gray-800 leading-tight truncate" title={result.product.sku + (result.grade ? ` [${result.grade.grade}]` : '')}>
                  {result.product.sku}{result.grade ? `  [${result.grade.grade}]` : ''}
                </p>
                {/* Barcode visual */}
                <div className="mt-1.5 h-10 w-full rounded-sm overflow-hidden bg-white flex items-center justify-center"
                  style={{
                    backgroundImage: `repeating-linear-gradient(90deg, #000 0px, #000 1px, transparent 1px, transparent 3px, #000 3px, #000 5px, transparent 5px, transparent 6px, #000 6px, #000 7px, transparent 7px, transparent 10px)`,
                    backgroundSize: '10px 100%',
                  }}
                />
                <p className="text-[9px] font-mono text-gray-700 text-center mt-1 tracking-wider">{result.serialNumber}</p>
              </div>
              <div className="flex flex-col gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={printLabel}
                  disabled={printing || dymoStatus !== 'ready'}
                  className="flex items-center gap-1.5 h-8 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50 transition-colors"
                >
                  <Printer size={13} />
                  {printing ? 'Sending…' : 'Print Label'}
                </button>
                <span className="text-[9px] text-gray-400 text-center">DYMO 30334 · 2.25×1.25&quot;</span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-end">
            <button type="button" onClick={onClose}
              className="h-8 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
