'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import jsPDF from 'jspdf'
import { ClipboardCheck, MapPin, RefreshCcw, AlertCircle, X, Truck, Plus, Trash2 } from 'lucide-react'

const SO_STATUS_COLOR: Record<string, string> = {
  PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
  DRAFT: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  INVOICED: 'bg-yellow-100 text-yellow-700',
  PARTIALLY_PAID: 'bg-orange-100 text-orange-700',
  PAID: 'bg-green-100 text-green-700',
  VOID: 'bg-red-100 text-red-500',
}

const TERMS_LABEL: Record<string, string> = {
  NET_15: 'Net 15', NET_30: 'Net 30', NET_60: 'Net 60',
  NET_90: 'Net 90', DUE_ON_RECEIPT: 'Due on Receipt',
}

const PAYMENT_METHODS = ['CHECK', 'ACH', 'WIRE', 'CREDIT_CARD', 'CASH', 'OTHER']

interface OrderItem {
  id: string; productId?: string; sku?: string; title: string; description?: string
  quantity: number; unitPrice: number; discount: number; total: number; taxable: boolean
  isInvoiceAddon?: boolean
  product?: { id: string; sku: string } | null
  grade?: { grade: string } | null
}

interface SerialAssignment {
  id: string
  inventorySerial: { id: string; serialNumber: string; productId: string }
}

interface Allocation {
  id: string; amount: number
  payment: { paymentDate: string; method: string; reference?: string }
}

interface Address { addressLine1: string; addressLine2?: string; city: string; state: string; postalCode: string }

interface Order {
  id: string; orderNumber: string; status: string; fulfillmentStatus: string; orderDate: string; dueDate?: string
  customerPoNumber?: string
  customer: { id: string; companyName: string; paymentTerms: string }
  items: OrderItem[]
  allocations: Allocation[]
  serialAssignments?: SerialAssignment[]
  shippingAddress: Address | null
  billingAddress:  Address | null
  subtotal: number; discountPct: number; discountAmt: number
  taxRate: number; taxAmt: number; shippingCost: number
  total: number; paidAmount: number; balance: number
  notes?: string; internalNotes?: string
  invoiceNumber?: string; invoicedAt?: string
  shipCarrier?: string; shipTracking?: string; shippedAt?: string
}

function addrLines(a: Address | null): string[] {
  if (!a) return []
  return [
    a.addressLine1,
    ...(a.addressLine2 ? [a.addressLine2] : []),
    `${a.city}, ${a.state} ${a.postalCode}`,
  ]
}

function generateInvoicePDF(order: Order) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  const margin = 48
  const right = w - margin
  const isPaid = order.status === 'PAID'
  const $  = (n: number) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  // Brand colors
  const blue: [number, number, number] = [27, 94, 166]   // #1B5EA6
  const red: [number, number, number]  = [193, 52, 44]    // #C1342C
  const navy: [number, number, number] = [27, 58, 92]     // #1B3A5C
  const gray50: [number, number, number] = [249, 250, 251]
  const gray200: [number, number, number] = [229, 231, 235]
  const gray500: [number, number, number] = [107, 114, 128]
  const gray700: [number, number, number] = [55, 65, 81]
  const black: [number, number, number] = [17, 24, 39]

  // Helper: ensure page space
  function ensureSpace(needed: number) {
    if (y + needed > h - 60) {
      doc.addPage()
      y = margin
    }
  }

  // ─── Header: Stacked logo (matching login screen) ──────────────────
  // SVG viewBox 0 0 280 200 — icon dots at (58,104) and (212,54), midpoint (135,79)
  const sc = 0.45
  // Center of icon = midpoint of the two dots in SVG = x:135
  // We place the icon so its center is at this PDF x coordinate:
  const iconMidX = margin + 55
  const logoOx = iconMidX - 135 * sc // offset so SVG x:135 maps to iconMidX
  const logoOy = 10

  // Cubic bezier curve: P0=(60,105) CP1=(100,120) CP2=(160,40) P3=(210,55)
  const p0x = 60*sc+logoOx, p0y = 105*sc+logoOy
  const c1x = 100*sc+logoOx, c1y = 120*sc+logoOy
  const c2x = 160*sc+logoOx, c2y = 40*sc+logoOy
  const p3x = 210*sc+logoOx, p3y = 55*sc+logoOy

  doc.setLineWidth(1.6)
  for (let t = 0; t < 1; t += 0.04) {
    const t2 = Math.min(t + 0.04, 1)
    const bx = (ti: number) => Math.pow(1-ti,3)*p0x + 3*Math.pow(1-ti,2)*ti*c1x + 3*(1-ti)*ti*ti*c2x + ti*ti*ti*p3x
    const by = (ti: number) => Math.pow(1-ti,3)*p0y + 3*Math.pow(1-ti,2)*ti*c1y + 3*(1-ti)*ti*ti*c2y + ti*ti*ti*p3y
    const r = Math.round(blue[0] + (red[0]-blue[0])*t)
    const g = Math.round(blue[1] + (red[1]-blue[1])*t)
    const b = Math.round(blue[2] + (red[2]-blue[2])*t)
    doc.setDrawColor(r, g, b)
    doc.line(bx(t), by(t), bx(t2), by(t2))
  }

  // Left blue dot (ring + center fill) at SVG (58,104)
  const ldx = 58*sc+logoOx, ldy = 104*sc+logoOy
  doc.setDrawColor(...blue); doc.setLineWidth(1.8)
  doc.circle(ldx, ldy, 5, 'S')
  doc.setFillColor(...blue); doc.circle(ldx, ldy, 1.6, 'F')

  // Right red dot (ring + center fill) at SVG (212,54)
  const rdx = 212*sc+logoOx, rdy = 54*sc+logoOy
  doc.setDrawColor(...red); doc.setLineWidth(1.8)
  doc.circle(rdx, rdy, 5.5, 'S')
  doc.setFillColor(...red); doc.circle(rdx, rdy, 1.8, 'F')

  // Text centered on same midpoint as icon
  const textCx = iconMidX
  const textY = logoOy + 120 * sc + 8
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...navy)
  doc.text('OPEN LINE', textCx, textY, { align: 'center', charSpace: 2.5 })
  doc.setFontSize(9); doc.setTextColor(...red)
  doc.text('MOBILITY', textCx, textY + 13, { align: 'center', charSpace: 4 })

  const logoBottom = textY + 20

  // Invoice title block (right side, vertically centered with logo)
  doc.setFontSize(24); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
  doc.text('INVOICE', right, 42, { align: 'right' })
  // Colored accent line under INVOICE
  doc.setDrawColor(...blue); doc.setLineWidth(2)
  doc.line(right - 100, 48, right - 30, 48)
  doc.setDrawColor(...red); doc.setLineWidth(2)
  doc.line(right - 30, 48, right, 48)

  // ─── Invoice meta (right column) ──────────────────────────────────
  let y = 68
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
  const invRef = order.invoiceNumber ?? order.orderNumber
  const metaRows: [string, string][] = [
    ['Invoice #', invRef],
    ['Date', new Date(order.orderDate).toLocaleDateString()],
  ]
  if (order.dueDate) metaRows.push(['Due Date', new Date(order.dueDate).toLocaleDateString()])
  metaRows.push(['Terms', TERMS_LABEL[order.customer.paymentTerms] ?? order.customer.paymentTerms])
  if (order.customerPoNumber) metaRows.push(['Customer PO#', order.customerPoNumber])

  metaRows.forEach(([label, val]) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
    doc.text(label, right - 120, y)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text(val, right, y, { align: 'right' })
    y += 13
  })

  // ─── Bill To / Ship To ────────────────────────────────────────────
  y = Math.max(logoBottom, y + 6)
  const colBill = margin
  const colShip = margin + 180

  doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...blue)
  doc.text('BILL TO', colBill, y)
  doc.text('SHIP TO', colShip, y)
  y += 4
  doc.setDrawColor(...blue); doc.setLineWidth(0.8)
  doc.line(colBill, y, colBill + 50, y)
  doc.line(colShip, y, colShip + 50, y)
  y += 12

  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...black)
  doc.text(order.customer.companyName, colBill, y)
  doc.text(order.customer.companyName, colShip, y)
  y += 13

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...gray700)
  const billAddr = addrLines(order.billingAddress)
  const shipAddr = addrLines(order.shippingAddress)
  const maxAddr = Math.max(billAddr.length, shipAddr.length)
  for (let i = 0; i < maxAddr; i++) {
    if (billAddr[i]) doc.text(billAddr[i], colBill, y)
    if (shipAddr[i]) doc.text(shipAddr[i], colShip, y)
    y += 12
  }

  // ─── PAID watermark ───────────────────────────────────────────────
  if (isPaid) {
    doc.setFontSize(80); doc.setTextColor(220, 220, 220)
    doc.text('PAID', w / 2, h / 2 - 40, { align: 'center', angle: 40 } as Parameters<typeof doc.text>[3])
  }

  // ─── Line items table ─────────────────────────────────────────────
  y = Math.max(y + 20, 180)

  // Table header (rounded top)
  doc.setFillColor(...navy)
  doc.roundedRect(margin, y - 12, right - margin, 18, 4, 4, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255)
  doc.text('ITEM', margin + 8, y)
  doc.text('QTY', right - 145, y, { align: 'right' })
  doc.text('UNIT PRICE', right - 65, y, { align: 'right' })
  doc.text('AMOUNT', right - 6, y, { align: 'right' })
  y += 14

  // Table rows — two-line per item: SKU bold on top, description below
  const rowHeight = 28
  order.items.forEach((item, i) => {
    ensureSpace(rowHeight + 4)
    // Alternate row bg
    if (i % 2 === 0) {
      doc.setFillColor(...gray50)
      doc.roundedRect(margin, y - 10, right - margin, rowHeight, 2, 2, 'F')
    }
    // Line 1: SKU (bold) + numeric columns
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...navy)
    const skuLabel = item.sku ? item.sku : (item.isInvoiceAddon ? 'ADD-ON' : '—')
    doc.text(skuLabel, margin + 8, y)
    doc.setTextColor(...black)
    doc.text(String(Number(item.quantity)), right - 145, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.text($(item.unitPrice), right - 65, y, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text($(item.total), right - 6, y, { align: 'right' })
    // Line 2: Description
    y += 11
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...gray500)
    const titleStr = item.isInvoiceAddon ? `* ${item.title}` : item.title
    doc.text(titleStr.substring(0, 70), margin + 8, y)
    y += rowHeight - 11 + 4
  })

  // Bottom table border
  doc.setDrawColor(...gray200); doc.setLineWidth(0.5)
  doc.line(margin, y - 6, right, y - 6)

  // ─── Shipping Info (bordered grid, full width under items) ────────
  if (order.shipCarrier || order.shipTracking) {
    y += 10
    ensureSpace(60)

    const gridTop = y
    const gridH = 48
    const gridW = right - margin
    const colW = gridW / 3

    // Outer border with rounded corners
    doc.setDrawColor(...gray200); doc.setLineWidth(0.8)
    doc.roundedRect(margin, gridTop, gridW, gridH, 3, 3, 'S')

    // Header bar
    doc.setFillColor(...navy)
    doc.roundedRect(margin, gridTop, gridW, 16, 3, 3, 'F')
    doc.rect(margin, gridTop + 8, gridW, 8, 'F')

    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255)
    doc.text('SHIPPING DETAILS', margin + 10, gridTop + 11)

    // Column dividers
    doc.setDrawColor(...gray200); doc.setLineWidth(0.5)
    doc.line(margin + colW, gridTop + 16, margin + colW, gridTop + gridH)
    doc.line(margin + colW * 2, gridTop + 16, margin + colW * 2, gridTop + gridH)

    // Cell content
    const cellY = gridTop + 28
    const cells: [number, string, string][] = [
      [margin + 10, 'Carrier', order.shipCarrier || '—'],
      [margin + colW + 10, 'Tracking #', order.shipTracking || '—'],
      [margin + colW * 2 + 10, 'Ship Date', order.shippedAt ? new Date(order.shippedAt).toLocaleDateString() : '—'],
    ]
    cells.forEach(([x, label, value]) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...gray500)
      doc.text(label.toUpperCase(), x, cellY)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...black)
      doc.text(value, x, cellY + 12)
    })

    y = gridTop + gridH + 6
  }

  // ─── Totals block (right-aligned) ─────────────────────────────────
  y += 8
  const totalsX = right - 180
  ensureSpace(90)

  const summaryRows: [string, string, boolean?][] = [
    ['Subtotal', $(order.subtotal)],
    [`Tax (${Number(order.taxRate)}%)`, $(order.taxAmt)],
    ['Shipping', $(order.shippingCost)],
  ]
  summaryRows.forEach(([label, val]) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...gray500)
    doc.text(label, totalsX, y)
    doc.setTextColor(...black)
    doc.text(val, right - 6, y, { align: 'right' })
    y += 14
  })

  // Total due — highlighted
  doc.setFillColor(...navy)
  doc.roundedRect(totalsX - 6, y - 10, right - totalsX + 12, 20, 4, 4, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255)
  doc.text('TOTAL DUE', totalsX, y + 2)
  doc.text($(order.total), right - 6, y + 2, { align: 'right' })
  y += 26

  // Paid + Balance
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...gray500)
  doc.text('Amount Paid', totalsX, y)
  doc.setTextColor(22, 163, 74) // green-600
  doc.text(`-${$(order.paidAmount)}`, right - 6, y, { align: 'right' })
  y += 3
  doc.setDrawColor(...gray200); doc.setLineWidth(0.5)
  doc.line(totalsX, y, right, y)
  y += 13

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...red)
  doc.text('BALANCE DUE', totalsX, y)
  doc.text($(order.balance), right - 6, y, { align: 'right' })
  y += 6

  // ─── Notes ────────────────────────────────────────────────────────
  if (order.notes) {
    y += 16
    ensureSpace(40)
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...blue)
    doc.text('NOTES', margin, y)
    y += 3
    doc.setDrawColor(...blue); doc.setLineWidth(0.5)
    doc.line(margin, y, margin + 35, y)
    y += 10
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...gray700)
    const noteLines = doc.splitTextToSize(order.notes, right - margin)
    doc.text(noteLines, margin, y)
    y += noteLines.length * 11
  }

  // ─── Serial Numbers Section (new page) ─────────────────────────────
  if (order.serialAssignments && order.serialAssignments.length > 0) {
    doc.addPage()
    y = margin

    // Section header
    doc.setFillColor(...navy)
    doc.roundedRect(margin, y - 10, right - margin, 18, 4, 4, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255)
    doc.text('SERIAL NUMBERS', margin + 8, y + 1)
    y += 16

    // Group serials by product (match to items)
    const serialsByProduct = new Map<string, { sku: string; title: string; serials: string[] }>()
    for (const item of order.items) {
      const pid = item.productId ?? item.product?.id
      if (!pid) continue
      if (!serialsByProduct.has(pid)) {
        serialsByProduct.set(pid, {
          sku: item.sku ?? item.product?.sku ?? '—',
          title: item.title,
          serials: [],
        })
      }
    }
    for (const sa of order.serialAssignments) {
      const pid = sa.inventorySerial.productId
      const group = serialsByProduct.get(pid)
      if (group) {
        group.serials.push(sa.inventorySerial.serialNumber)
      } else {
        serialsByProduct.set(pid, { sku: '—', title: 'Other', serials: [sa.inventorySerial.serialNumber] })
      }
    }

    for (const [, group] of Array.from(serialsByProduct.entries())) {
      if (group.serials.length === 0) continue
      ensureSpace(30)
      // Item header
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...navy)
      doc.text(`${group.sku}`, margin + 8, y)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray700)
      doc.text(`— ${group.title}`, margin + 8 + doc.getTextWidth(group.sku + '  '), y)
      y += 12

      // Serials in columns
      const colWidth = 130
      const cols = Math.floor((right - margin - 8) / colWidth)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...gray700)
      group.serials.forEach((sn, idx) => {
        const col = idx % cols
        const row = Math.floor(idx / cols)
        if (col === 0 && row > 0) {
          y += 11
          ensureSpace(14)
        }
        const sx = margin + 12 + col * colWidth
        // Small bullet
        doc.setFillColor(...blue)
        doc.circle(sx, y - 2.5, 1.5, 'F')
        doc.setTextColor(...black)
        doc.text(sn, sx + 6, y)
      })
      y += 16
    }
  }

  // ─── Footer ───────────────────────────────────────────────────────
  const footY = h - 36
  doc.setDrawColor(...gray200); doc.setLineWidth(0.5)
  doc.line(margin, footY - 8, right, footY - 8)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...gray500)
  doc.text('Open Line Mobility, Ltd.', margin, footY)
  doc.text('Thank you for your business.', w / 2, footY, { align: 'center' })
  doc.text(`${invRef}`, right, footY, { align: 'right' })

  doc.save(`Invoice-${invRef}.pdf`)
}

export default function WholesaleOrderDetailManager({ id }: { id: string }) {
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [transitioning, setTransitioning] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [payForm, setPayForm] = useState({
    amount: '', method: 'CHECK', reference: '', memo: '',
  })
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [showProcessModal, setShowProcessModal] = useState(false)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/wholesale/orders/${id}`)
      if (res.ok) setOrder(await res.json())
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function transition(newStatus: string) {
    setTransitioning(true)
    try {
      const res = await fetch(`/api/wholesale/orders/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Failed'); return }
      if (data.warning) toast.warning(data.warning)
      if (data.alerts?.length) data.alerts.forEach((a: string) => toast.warning(a))
      if (data.autoProcessed) {
        toast.success('Order approved & auto-processed to fulfillment')
      } else {
        toast.success(`Status updated to ${newStatus}`)
      }
      load()
    } finally {
      setTransitioning(false)
    }
  }

  async function recordPayment() {
    if (!payForm.amount || Number(payForm.amount) <= 0) { toast.error('Enter amount'); return }
    setPaymentSaving(true)
    try {
      const res = await fetch('/api/wholesale/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: order!.customer.id,
          amount: Number(payForm.amount),
          method: payForm.method,
          reference: payForm.reference,
          memo: payForm.memo,
          allocations: [{ orderId: id, amount: Number(payForm.amount) }],
        }),
      })
      if (!res.ok) { const e = await res.json(); toast.error(e.error ?? 'Failed'); return }
      toast.success('Payment recorded')
      setShowPaymentModal(false)
      setPayForm({ amount: '', method: 'CHECK', reference: '', memo: '' })
      load()
    } finally {
      setPaymentSaving(false)
    }
  }

  const fmt = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
  if (!order)  return <div className="p-8 text-center text-gray-400 text-sm">Order not found</div>

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">←</button>
        <h1 className="font-mono text-2xl font-bold text-orange-600">{order.orderNumber}</h1>
        <span className={`inline-flex px-2.5 py-1 rounded text-xs font-semibold ${SO_STATUS_COLOR[order.status]}`}>
          {order.status.replace('_', ' ')}
        </span>
        {order.status === 'CONFIRMED' && order.fulfillmentStatus === 'SHIPPED' && (
          <span className="inline-flex px-2.5 py-1 rounded text-xs font-semibold bg-amber-100 text-amber-700">
            SHIPPED — NOT YET INVOICED
          </span>
        )}
        <Link href={`/wholesale/customers/${order.customer.id}`} className="text-sm text-gray-600 hover:text-orange-600">
          {order.customer.companyName}
        </Link>
        {order.customerPoNumber && (
          <span className="text-sm text-gray-500">PO# <span className="font-mono font-medium text-gray-700">{order.customerPoNumber}</span></span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {order.status === 'PENDING_APPROVAL' && (
            <>
              <button onClick={() => transition('CONFIRMED')} disabled={transitioning}
                className="px-3 py-1.5 bg-green-500 text-white rounded text-xs font-medium hover:bg-green-600 disabled:opacity-50">
                {transitioning ? 'Approving…' : 'Approve Order'}
              </button>
              <button onClick={() => transition('VOID')} disabled={transitioning}
                className="px-3 py-1.5 bg-red-100 text-red-600 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-50">
                Delete
              </button>
            </>
          )}
          {order.status === 'DRAFT' && (
            <>
              <button onClick={() => transition('CONFIRMED')} disabled={transitioning}
                className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 disabled:opacity-50">
                Confirm Order
              </button>
              <button onClick={() => transition('VOID')} disabled={transitioning}
                className="px-3 py-1.5 bg-red-100 text-red-600 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-50">
                Delete
              </button>
            </>
          )}
          {order.status === 'CONFIRMED' && (
            <>
              {order.fulfillmentStatus === 'PENDING' && (
                <button onClick={() => setShowProcessModal(true)}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700 flex items-center gap-1">
                  <ClipboardCheck size={12} /> Process to Fulfillment
                </button>
              )}
              {order.fulfillmentStatus === 'SHIPPED' ? (
                <button onClick={() => setShowInvoiceModal(true)}
                  className="px-3 py-1.5 bg-yellow-500 text-white rounded text-xs font-medium hover:bg-yellow-600 flex items-center gap-1">
                  Create Invoice
                </button>
              ) : (
                <button onClick={() => transition('INVOICED')} disabled={transitioning}
                  className="px-3 py-1.5 bg-yellow-500 text-white rounded text-xs font-medium hover:bg-yellow-600 disabled:opacity-50">
                  Mark as Invoiced
                </button>
              )}
              {order.fulfillmentStatus === 'PENDING' && (
                <button onClick={() => transition('VOID')} disabled={transitioning}
                  className="px-3 py-1.5 bg-red-100 text-red-600 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-50">
                  Delete
                </button>
              )}
            </>
          )}
          {(order.status === 'INVOICED' || order.status === 'PARTIALLY_PAID') && (
            <>
              <button onClick={() => setShowPaymentModal(true)}
                className="px-3 py-1.5 bg-green-500 text-white rounded text-xs font-medium hover:bg-green-600">
                Record Payment
              </button>
              <button onClick={() => generateInvoicePDF(order)}
                className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-50">
                Print Invoice
              </button>
            </>
          )}
          {order.status === 'PAID' && (
            <button onClick={() => generateInvoicePDF(order)}
              className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-50">
              Print Invoice
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: addresses + items + notes */}
        <div className="lg:col-span-2 space-y-4">
          {/* Addresses */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Bill To', addr: order.billingAddress },
              { label: 'Ship To', addr: order.shippingAddress },
            ].map(({ label, addr }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-sm">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{label}</p>
                {addr ? (
                  <>
                    <p className="font-medium text-gray-700">{order.customer.companyName}</p>
                    <p className="text-gray-600">{addr.addressLine1}</p>
                    {addr.addressLine2 && <p className="text-gray-600">{addr.addressLine2}</p>}
                    <p className="text-gray-600">{addr.city}, {addr.state} {addr.postalCode}</p>
                  </>
                ) : <p className="text-gray-400">—</p>}
              </div>
            ))}
          </div>

          {/* Shipping & serial info */}
          {order.fulfillmentStatus === 'SHIPPED' && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase">
                <Truck size={13} /> Shipping Details
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-400">Carrier</p>
                  <p className="font-medium text-gray-700">{order.shipCarrier || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Tracking</p>
                  <p className="font-mono font-medium text-gray-700">{order.shipTracking || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Shipped</p>
                  <p className="font-medium text-gray-700">
                    {order.shippedAt ? new Date(order.shippedAt).toLocaleDateString() : '—'}
                  </p>
                </div>
              </div>
              {order.serialAssignments && order.serialAssignments.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Assigned Serial Numbers</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {order.serialAssignments.map((sa) => (
                      <div key={sa.id} className="px-2.5 py-1.5 rounded bg-gray-50 border border-gray-100 font-mono text-xs text-gray-700">
                        {sa.inventorySerial.serialNumber}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Line items */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">Line Items</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                  <th className="text-left px-5 py-2">SKU</th>
                  <th className="text-left px-5 py-2">Description</th>
                  <th className="text-left px-5 py-2">Grade</th>
                  <th className="text-right px-5 py-2">Qty</th>
                  <th className="text-right px-5 py-2">Unit Price</th>
                  <th className="text-right px-5 py-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-5 py-2 font-mono text-xs text-gray-500">{item.sku ?? '—'}</td>
                    <td className="px-5 py-2">{item.title}</td>
                    <td className="px-5 py-2 text-xs text-gray-600">{item.grade?.grade ?? '—'}</td>
                    <td className="px-5 py-2 text-right">{Number(item.quantity)}</td>
                    <td className="px-5 py-2 text-right">{fmt(Number(item.unitPrice))}</td>
                    <td className="px-5 py-2 text-right font-medium">{fmt(Number(item.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Notes */}
          {(order.notes || order.internalNotes) && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm space-y-2">
              {order.notes && (
                <div><p className="text-xs font-semibold text-gray-400 uppercase">Notes</p><p>{order.notes}</p></div>
              )}
              {order.internalNotes && (
                <div><p className="text-xs font-semibold text-gray-400 uppercase">Internal Notes</p><p>{order.internalNotes}</p></div>
              )}
            </div>
          )}
        </div>

        {/* Right: totals + payments */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal</span>
              <span>{fmt(Number(order.subtotal))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Tax ({Number(order.taxRate)}%)</span>
              <span>{fmt(Number(order.taxAmt))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Shipping</span>
              <span>{fmt(Number(order.shippingCost))}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2">
              <span>Total</span>
              <span>{fmt(Number(order.total))}</span>
            </div>
            <div className="flex justify-between text-green-600">
              <span>Paid</span>
              <span>-{fmt(Number(order.paidAmount))}</span>
            </div>
            <div className="flex justify-between font-bold text-orange-600 border-t border-gray-200 pt-2">
              <span>Balance Due</span>
              <span>{fmt(Number(order.balance))}</span>
            </div>
          </div>

          {/* Payment history */}
          {order.allocations.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-3">Payment History</p>
              <div className="space-y-2 text-sm">
                {order.allocations.map((alloc) => (
                  <div key={alloc.id} className="flex justify-between items-center">
                    <div>
                      <p className="font-medium">{alloc.payment.method}</p>
                      <p className="text-xs text-gray-400">{new Date(alloc.payment.paymentDate).toLocaleDateString()}</p>
                      {alloc.payment.reference && <p className="text-xs text-gray-400">Ref: {alloc.payment.reference}</p>}
                    </div>
                    <span className="text-green-600 font-semibold">{fmt(Number(alloc.amount))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Payment modal */}
      {/* Process to Fulfillment modal */}
      {showProcessModal && <ProcessModal orderId={order.id} orderNumber={order.orderNumber} onClose={() => setShowProcessModal(false)} onProcessed={() => { setShowProcessModal(false); load() }} />}
      {showInvoiceModal && <CreateInvoiceModal order={order} onClose={() => setShowInvoiceModal(false)} onCreated={() => { setShowInvoiceModal(false); load() }} />}

      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowPaymentModal(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">Record Payment</h3>
            <p className="text-sm text-gray-500">Balance due: <strong>{fmt(Number(order.balance))}</strong></p>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount *</label>
              <input
                type="number" min="0" step="0.01"
                value={payForm.amount}
                onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
              <select
                value={payForm.method}
                onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reference #</label>
              <input
                type="text"
                value={payForm.reference}
                onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Memo</label>
              <input
                type="text"
                value={payForm.memo}
                onChange={(e) => setPayForm((f) => ({ ...f, memo: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={recordPayment}
                disabled={paymentSaving}
                className="flex-1 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-50"
              >
                {paymentSaving ? 'Saving…' : 'Record Payment'}
              </button>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Create Invoice Modal ────────────────────────────────────────────────────

interface AddonRow { title: string; quantity: string; unitPrice: string }

function CreateInvoiceModal({ order, onClose, onCreated }: {
  order: Order; onClose: () => void; onCreated: () => void
}) {
  const [addons, setAddons] = useState<AddonRow[]>([])
  const [shippingCost, setShippingCost] = useState(String(Number(order.shippingCost)))
  const [notes, setNotes] = useState(order.notes ?? '')
  const [saving, setSaving] = useState(false)

  const fmt = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  const existingItemsTotal = order.items
    .filter((i) => !i.isInvoiceAddon)
    .reduce((s, i) => s + Number(i.total), 0)
  const addonsTotal = addons.reduce((s, r) => {
    const q = parseFloat(r.quantity) || 0
    const p = parseFloat(r.unitPrice) || 0
    return s + q * p
  }, 0)
  const shipNum = parseFloat(shippingCost) || 0
  const runningTotal = existingItemsTotal + addonsTotal + shipNum

  function addRow() {
    setAddons((prev) => [...prev, { title: '', quantity: '1', unitPrice: '0' }])
  }
  function removeRow(idx: number) {
    setAddons((prev) => prev.filter((_, i) => i !== idx))
  }
  function updateRow(idx: number, field: keyof AddonRow, value: string) {
    setAddons((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  }

  async function handleSubmit() {
    const validAddons = addons.filter((r) => r.title.trim() && parseFloat(r.quantity) > 0 && parseFloat(r.unitPrice) >= 0)
    setSaving(true)
    try {
      const res = await fetch(`/api/wholesale/orders/${order.id}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          additionalItems: validAddons.map((r) => ({
            title: r.title.trim(),
            quantity: parseFloat(r.quantity),
            unitPrice: parseFloat(r.unitPrice),
          })),
          shippingCost: shipNum,
          notes: notes.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? 'Failed to create invoice')
        return
      }
      toast.success('Invoice created')
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Create Invoice</h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{order.orderNumber}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Existing line items (read-only) */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Shipped Items</p>
            <div className="space-y-1">
              {order.items.filter((i) => !i.isInvoiceAddon).map((item) => (
                <div key={item.id} className="flex items-center justify-between text-xs bg-gray-50 rounded px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-gray-500 mr-2">{item.sku ?? '—'}</span>
                    <span className="text-gray-700">{item.title}</span>
                    <span className="text-gray-400 ml-2">x{Number(item.quantity)}</span>
                  </div>
                  <span className="font-medium text-gray-700 ml-3">{fmt(Number(item.total))}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Additional charges */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase">Additional Charges</p>
              <button onClick={addRow} className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-medium">
                <Plus size={12} /> Add Row
              </button>
            </div>
            {addons.length === 0 && (
              <p className="text-xs text-gray-400 italic">No additional charges. Click "Add Row" to add.</p>
            )}
            {addons.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-2">
                <input
                  type="text" placeholder="Title"
                  value={row.title}
                  onChange={(e) => updateRow(idx, 'title', e.target.value)}
                  className="flex-1 border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
                <input
                  type="number" placeholder="Qty" min="1" step="1"
                  value={row.quantity}
                  onChange={(e) => updateRow(idx, 'quantity', e.target.value)}
                  className="w-16 border border-gray-200 rounded px-2.5 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
                <input
                  type="number" placeholder="Price" min="0" step="0.01"
                  value={row.unitPrice}
                  onChange={(e) => updateRow(idx, 'unitPrice', e.target.value)}
                  className="w-24 border border-gray-200 rounded px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
                <span className="text-xs font-medium text-gray-600 w-20 text-right">
                  {fmt((parseFloat(row.quantity) || 0) * (parseFloat(row.unitPrice) || 0))}
                </span>
                <button onClick={() => removeRow(idx)} className="text-gray-400 hover:text-red-500">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* Shipping cost */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Shipping Cost</label>
            <input
              type="number" min="0" step="0.01"
              value={shippingCost}
              onChange={(e) => setShippingCost(e.target.value)}
              className="w-40 border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </div>

          {/* Running total */}
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Line items</span><span>{fmt(existingItemsTotal)}</span>
            </div>
            {addonsTotal > 0 && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Additional charges</span><span>{fmt(addonsTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs text-gray-500">
              <span>Shipping</span><span>{fmt(shipNum)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 mt-2 pt-2">
              <span>Estimated Total</span><span>{fmt(runningTotal)}</span>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t shrink-0 flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-1.5 text-xs bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 font-medium">
            {saving ? 'Creating…' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Process Modal ────────────────────────────────────────────────────────────

interface InventoryLocation {
  locationId: string; locationName: string; warehouseName: string
  qty: number; gradeId: string | null; gradeName: string | null
}
interface OrderItemInventory {
  orderItemId: string; sellerSku: string | null; title: string | null
  quantityOrdered: number; productId: string | null; totalQtyAvailable: number
  locations: InventoryLocation[]
}
interface ReservationSelection {
  orderItemId: string; productId: string; locationId: string
  qtyReserved: number; gradeId: string | null
}

function ProcessModal({ orderId, orderNumber, onClose, onProcessed }: {
  orderId: string; orderNumber: string; onClose: () => void; onProcessed: () => void
}) {
  const [inventoryData, setInventoryData] = useState<{ items: OrderItemInventory[] } | null>(null)
  const [loading, setLoading]       = useState(true)
  const [loadErr, setLoadErr]       = useState<string | null>(null)
  const [selections, setSelections] = useState<Record<string, ReservationSelection>>({})
  const [processing, setProcessing] = useState(false)
  const [processErr, setProcessErr] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setLoadErr(null)
    fetch(`/api/wholesale/orders/${orderId}/inventory`)
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error ?? String(r.status)))))
      .then((data: { items: OrderItemInventory[] }) => {
        setInventoryData(data)
        const initial: Record<string, ReservationSelection> = {}
        for (const item of data.items) {
          if (!item.productId || item.locations.length === 0) continue
          const best = item.locations.find(l => l.qty >= item.quantityOrdered) ?? item.locations[0]
          initial[item.orderItemId] = {
            orderItemId: item.orderItemId, productId: item.productId,
            locationId: best.locationId, qtyReserved: Math.min(item.quantityOrdered, best.qty),
            gradeId: best.gradeId ?? null,
          }
        }
        setSelections(initial)
      })
      .catch(e => setLoadErr(e instanceof Error ? e.message : 'Failed to load inventory'))
      .finally(() => setLoading(false))
  }, [orderId])

  const allItemsHaveStock = inventoryData?.items.every(item =>
    !item.productId ? false : item.totalQtyAvailable >= item.quantityOrdered
  ) ?? false

  const allSelectionsValid = inventoryData?.items.every(item => {
    if (!item.productId) return false
    const sel = selections[item.orderItemId]
    if (!sel) return false
    const loc = item.locations.find(l => l.locationId === sel.locationId && (l.gradeId ?? '') === (sel.gradeId ?? ''))
    return loc && sel.qtyReserved >= 1 && sel.qtyReserved <= loc.qty
  }) ?? false

  async function handleConfirm() {
    if (!allSelectionsValid) return
    setProcessing(true); setProcessErr(null)
    try {
      const res = await fetch(`/api/wholesale/orders/${orderId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservations: Object.values(selections) }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      toast.success('Order processed to fulfillment')
      onProcessed()
    } catch (e) { setProcessErr(e instanceof Error ? e.message : 'Failed to process order') }
    finally { setProcessing(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <ClipboardCheck size={15} className="text-emerald-600" /> Process to Fulfillment
            </h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{orderNumber}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {loading && <div className="flex items-center gap-2 text-sm text-gray-500 py-4"><RefreshCcw size={13} className="animate-spin" /> Loading inventory…</div>}
          {loadErr && <div className="flex items-start gap-2 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={12} className="shrink-0 mt-0.5" />{loadErr}</div>}
          {!loading && inventoryData && inventoryData.items.map(item => {
            const sel = selections[item.orderItemId]
            const hasProduct = !!item.productId
            const hasStock = item.totalQtyAvailable >= item.quantityOrdered
            return (
              <div key={item.orderItemId} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs font-semibold text-gray-800">{item.sellerSku ?? '—'}</p>
                    <p className="text-xs text-gray-500 truncate">{item.title ?? '—'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Qty: <strong>{item.quantityOrdered}</strong></p>
                  </div>
                  {!hasProduct && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium shrink-0">No product</span>}
                  {hasProduct && !hasStock && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium shrink-0">Out of stock</span>}
                  {hasProduct && hasStock && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium shrink-0">{item.totalQtyAvailable} available</span>}
                </div>
                {hasProduct && item.locations.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600 flex items-center gap-1"><MapPin size={10} /> Location & Grade</label>
                    <select value={`${sel?.locationId ?? ''}::${sel?.gradeId ?? ''}`} onChange={e => {
                      const [locId, grId] = e.target.value.split('::')
                      const loc = item.locations.find(l => l.locationId === locId && (l.gradeId ?? '') === (grId ?? ''))
                      if (!loc || !item.productId) return
                      setSelections(prev => ({
                        ...prev,
                        [item.orderItemId]: {
                          orderItemId: item.orderItemId, productId: item.productId!,
                          locationId: loc.locationId, qtyReserved: Math.min(prev[item.orderItemId]?.qtyReserved ?? item.quantityOrdered, loc.qty),
                          gradeId: loc.gradeId ?? null,
                        },
                      }))
                    }} className="w-full h-7 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
                      {item.locations.map(loc => (
                        <option key={`${loc.locationId}::${loc.gradeId ?? ''}`} value={`${loc.locationId}::${loc.gradeId ?? ''}`}>
                          {loc.warehouseName} › {loc.locationName}
                          {loc.gradeName ? ` [Grade ${loc.gradeName}]` : ''} — {loc.qty} avail
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-gray-600">Qty to reserve</label>
                      <input type="number" min={1} max={item.locations.find(l => l.locationId === sel?.locationId && (l.gradeId ?? null) === (sel?.gradeId ?? null))?.qty ?? item.quantityOrdered} value={sel?.qtyReserved ?? item.quantityOrdered}
                        onChange={e => {
                          const v = Math.max(1, parseInt(e.target.value) || 1)
                          setSelections(prev => ({ ...prev, [item.orderItemId]: { ...prev[item.orderItemId], qtyReserved: v } }))
                        }}
                        className="w-16 h-7 rounded border border-gray-300 px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                      <span className="text-xs text-gray-400">of {item.quantityOrdered}</span>
                    </div>
                  </div>
                )}
                {hasProduct && item.locations.length === 0 && <p className="text-xs text-gray-500 italic">No inventory found for this SKU.</p>}
              </div>
            )
          })}
        </div>
        <div className="px-5 py-3 border-t shrink-0 space-y-2">
          {processErr && <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={12} className="shrink-0 mt-0.5" />{processErr}</div>}
          {!allItemsHaveStock && !loading && <div className="flex items-start gap-2 p-2 rounded bg-amber-50 border border-amber-200 text-amber-700 text-xs"><AlertCircle size={12} className="shrink-0 mt-0.5" />One or more items are out of stock.</div>}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleConfirm} disabled={processing || !allSelectionsValid || !allItemsHaveStock}
              className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5">
              {processing ? <><RefreshCcw size={12} className="animate-spin" /> Reserving…</> : 'Reserve & Process'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
