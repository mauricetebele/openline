import jsPDF, { GState } from 'jspdf'

// ─── Types ───────────────────────────────────────────────────────────────────

interface InvoiceOrderItem {
  id: string
  orderItemId: string
  sellerSku: string | null
  title: string | null
  quantityOrdered: number
  itemPrice: string | null
  itemTax?: string | null
}

interface InvoiceSerialAssignment {
  orderItemId: string
  inventorySerial: { serialNumber: string }
}

interface InvoiceLabelSummary {
  trackingNumber: string
  carrier: string | null
  serviceCode: string | null
  shipmentCost: string | null
}

interface InvoiceOrder {
  amazonOrderId: string
  olmNumber: number | null
  purchaseDate: string
  orderTotal: string | null
  currency: string | null
  shipToName: string | null
  shipToAddress1: string | null
  shipToAddress2: string | null
  shipToCity: string | null
  shipToState: string | null
  shipToPostal: string | null
  shipToCountry: string | null
  items: InvoiceOrderItem[]
  serialAssignments?: InvoiceSerialAssignment[]
  label?: InvoiceLabelSummary | null
  customerPo?: string | null
  shippedAt?: string | null
  shipCarrier?: string | null
  shipTracking?: string | null
  orderSource?: string | null
}

interface StoreSettings {
  storeName: string
  logoBase64: string | null
  phone: string | null
  email: string | null
  addressLine: string | null
  city: string | null
  state: string | null
  zip: string | null
  thankYouMsg: string
  primaryColor: string
  accentColor: string
}

// ─── Colors ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)]
}

const C = {
  navy:     [20, 40, 75] as [number, number, number],
  accent:   [0, 122, 204] as [number, number, number],
  dark:     [35, 40, 50],
  text:     [55, 65, 80],
  muted:    [120, 130, 145],
  light:    [245, 247, 250],
  border:   [215, 220, 228],
  white:    [255, 255, 255],
  headerBg: [248, 249, 251],
  green:    [22, 163, 74],
} as const

type RGB = readonly [number, number, number]

function tc(doc: jsPDF, c: RGB) { doc.setTextColor(c[0], c[1], c[2]) }
function fc(doc: jsPDF, c: RGB) { doc.setFillColor(c[0], c[1], c[2]) }
function dc(doc: jsPDF, c: RGB) { doc.setDrawColor(c[0], c[1], c[2]) }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(amount: string | null): string {
  if (!amount) return '$0.00'
  const num = parseFloat(amount)
  return isNaN(num) ? '$0.00' : `$${num.toFixed(2)}`
}

function trunc(str: string, maxW: number, doc: jsPDF): string {
  if (doc.getTextWidth(str) <= maxW) return str
  let s = str
  while (s.length > 0 && doc.getTextWidth(s + '...') > maxW) s = s.slice(0, -1)
  return s + '...'
}

function storeAddrLines(s: StoreSettings): string[] {
  const lines: string[] = []
  if (s.addressLine) lines.push(s.addressLine)
  const csz = [s.city, s.state ? `${s.state} ${s.zip ?? ''}`.trim() : s.zip].filter(Boolean).join(', ')
  if (csz) lines.push(csz)
  return lines
}

function shipAddrLines(order: InvoiceOrder): string[] {
  const lines: string[] = []
  if (order.shipToName) lines.push(order.shipToName)
  if (order.shipToAddress1) lines.push(order.shipToAddress1)
  if (order.shipToAddress2) lines.push(order.shipToAddress2)
  const csz = [order.shipToCity, order.shipToState ? `${order.shipToState} ${order.shipToPostal ?? ''}`.trim() : order.shipToPostal].filter(Boolean).join(', ')
  if (csz) lines.push(csz)
  if (order.shipToCountry && order.shipToCountry !== 'US') lines.push(order.shipToCountry)
  return lines
}

// ─── Section card drawing helpers ────────────────────────────────────────────

/** Draw a section card header bar (like the gray bg-gray-50 header in OrderDetailView) */
function sectionHeader(doc: jsPDF, x: number, y: number, w: number, title: string): number {
  const h = 18
  // Border around header
  dc(doc, C.border)
  doc.setLineWidth(0.5)
  // Header fill
  fc(doc, C.headerBg)
  doc.roundedRect(x, y, w, h, 3, 3, 'F')
  // Only round top corners — draw bottom border flush
  fc(doc, C.white)
  doc.rect(x, y + h - 3, w, 3, 'F')

  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  tc(doc, C.muted)
  doc.text(title.toUpperCase(), x + 8, y + 12)
  return y + h
}

/** Draw the full border of a section card body */
function sectionBox(doc: jsPDF, x: number, y: number, w: number, h: number) {
  dc(doc, C.border)
  doc.setLineWidth(0.5)
  doc.roundedRect(x, y, w, h, 3, 3, 'S')
}

/** Check if we need a page break; return new y */
function needsBreak(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > doc.internal.pageSize.getHeight() - 55) {
    doc.addPage()
    return 30
  }
  return y
}

// ─── PDF Generator ───────────────────────────────────────────────────────────

export async function generateOrderInvoicePDF(order: InvoiceOrder) {
  // Fetch store settings
  let store: StoreSettings = {
    storeName: 'Open Line Mobility', logoBase64: null, phone: null, email: null,
    addressLine: null, city: null, state: null, zip: null,
    thankYouMsg: 'Thank you for shopping with us!',
    primaryColor: '#14284B', accentColor: '#007ACC',
  }
  try {
    const res = await fetch('/api/store-settings')
    if (res.ok) store = { ...store, ...(await res.json()) }
  } catch { /* defaults */ }

  const primary = hexToRgb(store.primaryColor) as RGB
  const accent = hexToRgb(store.accentColor) as RGB

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()   // 612
  const H = doc.internal.pageSize.getHeight()  // 792
  const ML = 36  // margin left
  const MR = W - 36  // margin right
  const CW = MR - ML // content width

  // Serial map: orderItemId → serialNumber[]
  const serialMap = new Map<string, string[]>()
  if (order.serialAssignments) {
    for (const sa of order.serialAssignments) {
      const list = serialMap.get(sa.orderItemId) ?? []
      list.push(sa.inventorySerial.serialNumber)
      serialMap.set(sa.orderItemId, list)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HEADER — Logo left, Invoice meta right
  // ═══════════════════════════════════════════════════════════════════════════

  // Accent stripe
  fc(doc, primary)
  doc.rect(0, 0, W, 5, 'F')

  let logoBottomY = 40

  // Logo or text branding
  if (store.logoBase64) {
    try {
      doc.addImage(store.logoBase64, 'AUTO', ML, 16, 0, 120)
      logoBottomY = 140
    } catch {
      doc.setFontSize(15); doc.setFont('helvetica', 'bold'); tc(doc, primary)
      doc.text(store.storeName.toUpperCase(), ML, 36)
      logoBottomY = 44
    }
  } else {
    doc.setFontSize(15); doc.setFont('helvetica', 'bold'); tc(doc, primary)
    doc.text(store.storeName.toUpperCase(), ML, 36)
    logoBottomY = 44
  }

  // Store contact info — stacked lines under logo
  const addrLines = storeAddrLines(store)
  const contactLines = [...addrLines]
  const phoneLine = [store.phone, store.email].filter(Boolean).join('  |  ')
  if (phoneLine) contactLines.push(phoneLine)
  if (contactLines.length > 0) {
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); tc(doc, C.muted)
    for (const line of contactLines) {
      doc.text(line, ML, logoBottomY + 3)
      logoBottomY += 9
    }
    logoBottomY += 2
  }

  // Right side: INVOICE title + meta
  doc.setFontSize(22); doc.setFont('helvetica', 'bold'); tc(doc, primary)
  doc.text('INVOICE', MR, 32, { align: 'right' })

  const orderRef = order.olmNumber ? `OLM-${order.olmNumber}` : order.amazonOrderId
  const dateFmt = new Date(order.purchaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  const metaX = MR - 120
  let mY = 44
  tc(doc, C.muted); doc.text('Invoice #', metaX, mY)
  tc(doc, C.dark); doc.setFont('helvetica', 'bold'); doc.text(orderRef, MR, mY, { align: 'right' })
  mY += 12
  doc.setFont('helvetica', 'normal'); tc(doc, C.muted); doc.text('Order #', metaX, mY)
  tc(doc, C.dark); doc.text(order.amazonOrderId, MR, mY, { align: 'right' })
  mY += 12
  tc(doc, C.muted); doc.text('Date', metaX, mY)
  tc(doc, C.dark); doc.text(dateFmt, MR, mY, { align: 'right' })

  // Shipped date/time
  if (order.shippedAt) {
    mY += 12
    const shipDt = new Date(order.shippedAt)
    const shipFmt = shipDt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      + ' ' + shipDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    doc.setFont('helvetica', 'normal'); tc(doc, C.muted); doc.text('Shipped', metaX, mY)
    doc.setFont('helvetica', 'bold'); tc(doc, C.dark); doc.text(shipFmt, MR, mY, { align: 'right' })
  }

  // Customer PO # — only for non-marketplace orders (wholesale, etc.)
  const isMarketplace = ['amazon', 'backmarket'].includes(order.orderSource ?? '')
  if (!isMarketplace && order.customerPo) {
    mY += 12
    doc.setFont('helvetica', 'normal'); tc(doc, C.muted); doc.text('Customer PO #', metaX, mY)
    doc.setFont('helvetica', 'bold'); tc(doc, C.dark); doc.text(order.customerPo, MR, mY, { align: 'right' })
  }

  // PAID rubber-stamp for shipped marketplace orders
  if (isMarketplace) {
    const stampColor: RGB = [180, 30, 30]
    const cx = W / 2, cy = 85
    const ang = -16 * Math.PI / 180
    const ca = Math.cos(ang), sa = Math.sin(ang)
    const hw = 66, hh = 24
    const iw = hw - 5, ih = hh - 5

    doc.saveGraphicsState()
    doc.setGState(new GState({ opacity: 0.18 }))

    // PDF transform: translate to (cx, cy) then rotate — all subsequent draws are axis-aligned at origin
    // PDF y-axis is flipped (0 at bottom), so cy becomes H - cy, and sin is negated
    const pdfCy = H - cy
    doc.internal.write(
      `${ca.toFixed(6)} ${(-sa).toFixed(6)} ${sa.toFixed(6)} ${ca.toFixed(6)} ${cx.toFixed(2)} ${pdfCy.toFixed(2)} cm`
    )

    dc(doc, stampColor); fc(doc, stampColor)

    // Seeded pseudo-random for deterministic wobble per order
    let seed = 0
    for (let i = 0; i < order.amazonOrderId.length; i++) seed = ((seed << 5) - seed + order.amazonOrderId.charCodeAt(i)) | 0
    function rand() { seed = (seed * 16807 + 0) % 2147483647; return (seed & 0x7fffffff) / 2147483647 }
    function jitter(amount: number) { return (rand() - 0.5) * amount }

    // Wobbly rounded rect — breaks each edge into small segments with perpendicular jitter
    function wobblyRect(w2: number, h2: number, r: number, wobble: number) {
      const f = (n: number) => n.toFixed(2)
      const K = 0.5523, kr = K * r
      const segs = 8 // segments per edge
      let path = ''

      // Start at top-left + r (with jitter)
      path += `${f(-w2 + r + jitter(wobble))} ${f(h2 + jitter(wobble))} m `

      // Top edge: left→right, jitter y
      for (let i = 1; i <= segs; i++) {
        const t = i / segs
        const x = (-w2 + r) + t * (2 * w2 - 2 * r)
        path += `${f(x + jitter(wobble))} ${f(h2 + jitter(wobble))} l `
      }
      // Top-right corner
      path += `${f(w2 - r + kr + jitter(wobble * 0.5))} ${f(h2 + jitter(wobble * 0.5))} ${f(w2 + jitter(wobble * 0.5))} ${f(h2 - r + kr + jitter(wobble * 0.5))} ${f(w2 + jitter(wobble * 0.5))} ${f(h2 - r + jitter(wobble * 0.5))} c `

      // Right edge: top→bottom, jitter x
      for (let i = 1; i <= segs; i++) {
        const t = i / segs
        const yy = (h2 - r) - t * (2 * h2 - 2 * r)
        path += `${f(w2 + jitter(wobble))} ${f(yy + jitter(wobble))} l `
      }
      // Bottom-right corner
      path += `${f(w2 + jitter(wobble * 0.5))} ${f(-h2 + r - kr + jitter(wobble * 0.5))} ${f(w2 - r + kr + jitter(wobble * 0.5))} ${f(-h2 + jitter(wobble * 0.5))} ${f(w2 - r + jitter(wobble * 0.5))} ${f(-h2 + jitter(wobble * 0.5))} c `

      // Bottom edge: right→left, jitter y
      for (let i = 1; i <= segs; i++) {
        const t = i / segs
        const x = (w2 - r) - t * (2 * w2 - 2 * r)
        path += `${f(x + jitter(wobble))} ${f(-h2 + jitter(wobble))} l `
      }
      // Bottom-left corner
      path += `${f(-w2 + r - kr + jitter(wobble * 0.5))} ${f(-h2 + jitter(wobble * 0.5))} ${f(-w2 + jitter(wobble * 0.5))} ${f(-h2 + r - kr + jitter(wobble * 0.5))} ${f(-w2 + jitter(wobble * 0.5))} ${f(-h2 + r + jitter(wobble * 0.5))} c `

      // Left edge: bottom→top, jitter x
      for (let i = 1; i <= segs; i++) {
        const t = i / segs
        const yy = (-h2 + r) + t * (2 * h2 - 2 * r)
        path += `${f(-w2 + jitter(wobble))} ${f(yy + jitter(wobble))} l `
      }
      // Top-left corner (close)
      path += `${f(-w2 + jitter(wobble * 0.5))} ${f(h2 - r + kr + jitter(wobble * 0.5))} ${f(-w2 + r - kr + jitter(wobble * 0.5))} ${f(h2 + jitter(wobble * 0.5))} ${f(-w2 + r + jitter(wobble * 0.5))} ${f(h2 + jitter(wobble * 0.5))} c `

      path += 'S'
      doc.internal.write(path)
    }

    // Outer border (thick, wobbly)
    doc.setLineWidth(3.5)
    wobblyRect(hw, hh, 6, 1.4)

    // Inner border (thin, wobbly)
    doc.setLineWidth(1.2)
    wobblyRect(iw, ih, 4, 1.0)

    // Text — raw PDF operators so it respects the cm transform (jsPDF's text() flips y internally)
    doc.setFontSize(42); doc.setFont('helvetica', 'bold'); tc(doc, stampColor)
    const tw = doc.getTextWidth('PAID')
    // Get the internal font object name for the Tf operator
    const fontObj = (doc as unknown as { internal: { getFont: () => { id: string } } }).internal.getFont()
    const fontKey = `/${fontObj.id}`
    doc.internal.write('BT')
    doc.internal.write(`${fontKey} 42 Tf`)
    doc.internal.write(`${(-tw / 2).toFixed(2)} -15 Td`)
    doc.internal.write('(PAID) Tj')
    doc.internal.write('ET')

    doc.restoreGraphicsState()
  }

  // Divider
  let y = Math.max(logoBottomY + 6, 78)
  dc(doc, C.border); doc.setLineWidth(0.75)
  doc.line(ML, y, MR, y)
  y += 14

  // ═══════════════════════════════════════════════════════════════════════════
  //  ROW 1 — Order Info (left) + Bill To (center) + Ship To (right)
  // ═══════════════════════════════════════════════════════════════════════════

  const itemsSub = order.items.reduce((s, i) => s + (i.itemPrice ? parseFloat(i.itemPrice) * i.quantityOrdered : 0), 0)
  const taxTotal = order.items.reduce((s, i) => s + (i.itemTax ? parseFloat(i.itemTax) : 0), 0)
  const shipCost = order.label?.shipmentCost ? parseFloat(order.label.shipmentCost) : 0
  const totalNum = order.orderTotal ? parseFloat(order.orderTotal) : itemsSub + taxTotal + shipCost

  const col1W = 190
  const gap = 10
  const addrColW = (CW - col1W - gap * 2) / 2
  const row1Top = y

  // ── Order Info card ────────────────────────────────────────────────────────
  let ly = sectionHeader(doc, ML, row1Top, col1W, 'Order Info')

  const channelName: Record<string, string> = { amazon: 'Amazon', backmarket: 'Back Market', wholesale: 'Wholesale' }
  const kvs: [string, string][] = [
    ['Order Date', dateFmt],
    ['Order #', order.amazonOrderId],
    ['Channel', channelName[order.orderSource ?? ''] ?? (order.orderSource || '—')],
    ['Items', String(order.items.length)],
    ['Qty Ordered', String(order.items.reduce((s, i) => s + i.quantityOrdered, 0))],
  ]

  doc.setFontSize(7.5)
  ly += 8
  for (const [label, val] of kvs) {
    doc.setFont('helvetica', 'normal'); tc(doc, C.muted)
    doc.text(label, ML + 8, ly)
    doc.setFont('helvetica', 'bold'); tc(doc, C.dark)
    doc.text(val, ML + col1W - 8, ly, { align: 'right' })
    ly += 12
  }

  // Tracking info (replaces financials)
  const trackNum = order.label?.trackingNumber ?? order.shipTracking
  const carrierName = order.label?.carrier ?? order.shipCarrier
  if (trackNum || carrierName) {
    ly += 2
    dc(doc, C.border); doc.setLineWidth(0.3)
    doc.line(ML + 8, ly, ML + col1W - 8, ly)
    ly += 8
    if (carrierName) {
      doc.setFont('helvetica', 'normal'); tc(doc, C.muted)
      doc.text('Carrier', ML + 8, ly)
      doc.setFont('helvetica', 'bold'); tc(doc, C.dark)
      doc.text(carrierName, ML + col1W - 8, ly, { align: 'right' })
      ly += 12
    }
    if (trackNum) {
      doc.setFont('helvetica', 'normal'); tc(doc, C.muted)
      doc.text('Tracking', ML + 8, ly)
      doc.setFont('helvetica', 'bold'); tc(doc, C.dark)
      doc.text(trunc(trackNum, col1W - 70, doc), ML + col1W - 8, ly, { align: 'right' })
      ly += 12
    }
    if (order.label?.serviceCode) {
      doc.setFont('helvetica', 'normal'); tc(doc, C.muted)
      doc.text('Service', ML + 8, ly)
      doc.setFont('helvetica', 'bold'); tc(doc, C.dark)
      doc.text(order.label.serviceCode, ML + col1W - 8, ly, { align: 'right' })
      ly += 12
    }
  }

  sectionBox(doc, ML, row1Top, col1W, ly - row1Top + 4)
  const leftBottom = ly + 4

  // ── Helper to draw an address card ─────────────────────────────────────────
  function drawAddrCard(cardX: number, cardW: number, title: string, lines: string[], minBottom: number) {
    let ay = sectionHeader(doc, cardX, row1Top, cardW, title)
    ay += 8
    doc.setFontSize(8)
    if (lines.length > 0) {
      doc.setFont('helvetica', 'bold'); tc(doc, C.dark)
      doc.text(trunc(lines[0], cardW - 16, doc), cardX + 8, ay); ay += 12
      doc.setFont('helvetica', 'normal'); tc(doc, C.text)
      for (let i = 1; i < lines.length; i++) {
        doc.text(trunc(lines[i], cardW - 16, doc), cardX + 8, ay); ay += 11
      }
    } else {
      doc.setFont('helvetica', 'italic'); tc(doc, C.muted)
      doc.text('—', cardX + 8, ay); ay += 12
    }
    const cardH = Math.max(ay + 6 - row1Top, minBottom - row1Top)
    sectionBox(doc, cardX, row1Top, cardW, cardH)
    return row1Top + cardH
  }

  const shipLines = shipAddrLines(order)
  const billToX = ML + col1W + gap
  const shipToX = billToX + addrColW + gap
  const billBottom = drawAddrCard(billToX, addrColW, 'Bill To', shipLines, leftBottom)
  const shipBottom = drawAddrCard(shipToX, addrColW, 'Ship To', shipLines, leftBottom)

  y = Math.max(leftBottom, billBottom, shipBottom) + 12

  // ═══════════════════════════════════════════════════════════════════════════
  //  ITEMS ORDERED — full-width section card with table
  // ═══════════════════════════════════════════════════════════════════════════

  y = needsBreak(doc, y, 80)
  const itemsTop = y
  y = sectionHeader(doc, ML, y, CW, 'Items Ordered')

  // Table header
  y += 2
  fc(doc, primary)
  doc.rect(ML + 0.5, y, CW - 1, 16, 'F')

  // Column positions
  const c1 = ML + 8        // SKU
  const c2 = ML + 145      // Product (wider SKU column)
  const c3 = ML + CW - 155 // Qty
  const c4 = ML + CW - 100 // Price
  const c5 = ML + CW - 10  // Total (right-aligned)
  const c2w = c3 - c2 - 10 // Product column max width

  doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); tc(doc, C.white)
  doc.text('SKU', c1, y + 11)
  doc.text('PRODUCT', c2, y + 11)
  doc.text('QTY', c3, y + 11, { align: 'right' })
  doc.text('UNIT PRICE', c4 + 10, y + 11, { align: 'right' })
  doc.text('TOTAL', c5, y + 11, { align: 'right' })
  y += 18

  // Table rows
  for (let i = 0; i < order.items.length; i++) {
    y = needsBreak(doc, y, 18)
    const item = order.items[i]
    const ext = item.itemPrice ? parseFloat(item.itemPrice) * item.quantityOrdered : 0

    // Zebra stripe
    if (i % 2 === 0) {
      fc(doc, C.light); doc.rect(ML + 0.5, y, CW - 1, 16, 'F')
    }

    doc.setFontSize(7.5)
    // SKU
    doc.setFont('helvetica', 'bold'); tc(doc, C.dark)
    doc.text(trunc(item.sellerSku ?? '—', 130, doc), c1, y + 11)
    // Product
    doc.setFont('helvetica', 'normal'); tc(doc, C.text)
    doc.text(trunc(item.title ?? '—', c2w, doc), c2, y + 11)
    // Qty
    tc(doc, C.dark); doc.text(String(item.quantityOrdered), c3, y + 11, { align: 'right' })
    // Unit price
    tc(doc, C.muted); doc.text(fmt(item.itemPrice), c4 + 10, y + 11, { align: 'right' })
    // Total
    doc.setFont('helvetica', 'bold'); tc(doc, C.dark)
    doc.text(fmt(String(ext)), c5, y + 11, { align: 'right' })

    y += 16
  }

  // Items card border
  y += 4
  sectionBox(doc, ML, itemsTop, CW, y - itemsTop)
  y += 12

  // ═══════════════════════════════════════════════════════════════════════════
  //  SERIALIZED UNITS — table card grouped by SKU
  // ═══════════════════════════════════════════════════════════════════════════

  // Build SKU → serial[] map
  const skuSerials = new Map<string, string[]>()
  if (order.serialAssignments && order.serialAssignments.length > 0) {
    for (const item of order.items) {
      const sns = serialMap.get(item.id)
      if (sns && sns.length > 0) {
        const sku = item.sellerSku ?? 'Unknown SKU'
        const existing = skuSerials.get(sku) ?? []
        existing.push(...sns)
        skuSerials.set(sku, existing)
      }
    }
  }

  if (skuSerials.size > 0) {
    // Estimate height needed
    let serialRows = 0
    for (const [, sns] of Array.from(skuSerials.entries())) serialRows += sns.length

    y = needsBreak(doc, y, 40 + serialRows * 14)
    const serialTop = y
    y = sectionHeader(doc, ML, y, CW, 'Serialized Units')

    // Table header
    y += 2
    fc(doc, [235, 238, 242])
    doc.rect(ML + 0.5, y, CW - 1, 14, 'F')
    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); tc(doc, C.muted)
    doc.text('#', ML + 8, y + 10)
    doc.text('SERIAL NUMBER', ML + 30, y + 10)
    doc.text('SKU', ML + CW / 2 + 20, y + 10)
    y += 16

    let idx = 1
    for (const [sku, sns] of Array.from(skuSerials.entries())) {
      for (const sn of sns) {
        y = needsBreak(doc, y, 14)

        if (idx % 2 === 0) {
          fc(doc, C.light); doc.rect(ML + 0.5, y - 1, CW - 1, 13, 'F')
        }

        doc.setFontSize(7.5)
        tc(doc, C.muted); doc.setFont('helvetica', 'normal')
        doc.text(String(idx), ML + 8, y + 8)
        tc(doc, C.dark); doc.setFont('helvetica', 'bold')
        doc.text(sn, ML + 30, y + 8)
        tc(doc, C.text); doc.setFont('helvetica', 'normal')
        doc.text(sku, ML + CW / 2 + 20, y + 8)

        y += 13
        idx++
      }
    }

    y += 4
    sectionBox(doc, ML, serialTop, CW, y - serialTop)
    y += 12
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  TOTALS SUMMARY BAR — right-aligned, like a receipt
  // ═══════════════════════════════════════════════════════════════════════════

  y = needsBreak(doc, y, 50)

  const totW = 190
  const totX = MR - totW
  const totTop = y

  // Background box — height depends on how many rows
  const extraRows = (taxTotal > 0 ? 1 : 0) + (shipCost > 0 ? 1 : 0)
  const totBoxH = 48 + extraRows * 13
  fc(doc, C.headerBg)
  doc.roundedRect(totX, totTop, totW, totBoxH, 4, 4, 'F')
  dc(doc, C.border); doc.setLineWidth(0.5)
  doc.roundedRect(totX, totTop, totW, totBoxH, 4, 4, 'S')

  let ty = totTop + 12
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); tc(doc, C.text)
  doc.text('Subtotal', totX + 10, ty)
  doc.text(fmt(String(itemsSub)), totX + totW - 10, ty, { align: 'right' })
  ty += 13

  if (taxTotal > 0) {
    doc.text('Tax', totX + 10, ty)
    doc.text(fmt(String(taxTotal)), totX + totW - 10, ty, { align: 'right' })
    ty += 13
  }

  if (shipCost > 0) {
    doc.text('Shipping', totX + 10, ty)
    doc.text(fmt(String(shipCost)), totX + totW - 10, ty, { align: 'right' })
    ty += 13
  }

  // Total line — with more breathing room
  ty += 2
  dc(doc, primary); doc.setLineWidth(0.8)
  doc.line(totX + 10, ty, totX + totW - 10, ty)
  ty += 12
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); tc(doc, primary)
  doc.text('ORDER TOTAL', totX + 10, ty)
  doc.text(fmt(String(totalNum)), totX + totW - 10, ty, { align: 'right' })

  y = totTop + totBoxH + 8

  // ═══════════════════════════════════════════════════════════════════════════
  //  FOOTER — Thank you + branding
  // ═══════════════════════════════════════════════════════════════════════════

  // If we're too close to footer, push to next page
  if (y > H - 70) {
    doc.addPage()
  }

  const footY = H - 52

  // Accent bar at bottom
  fc(doc, primary)
  doc.rect(0, H - 8, W, 8, 'F')

  // Divider
  dc(doc, C.border); doc.setLineWidth(0.5)
  doc.line(ML, footY - 6, MR, footY - 6)

  // Thank you message — centered, italic
  doc.setFontSize(9); doc.setFont('helvetica', 'bolditalic'); tc(doc, accent)
  doc.text(store.thankYouMsg, W / 2, footY + 6, { align: 'center' })

  // Store name left, date right
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); tc(doc, [170, 175, 185])
  doc.text(store.storeName, ML, footY + 20)
  doc.text(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`, MR, footY + 20, { align: 'right' })

  // ─── Open in new tab ─────────────────────────────────────────────────────────
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}
