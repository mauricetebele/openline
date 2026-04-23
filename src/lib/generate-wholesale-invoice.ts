import jsPDF from 'jspdf'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InvOrderItem {
  id: string; productId?: string; sku?: string; title: string; description?: string
  quantity: number; unitPrice: number; discount: number; total: number; taxable: boolean
  isInvoiceAddon?: boolean
  product?: { id: string; sku: string } | null
  grade?: { grade: string } | null
}

export interface InvSerialAssignment {
  id: string
  inventorySerial: { id: string; serialNumber: string; productId: string }
}

interface InvAddress { addressLine1: string; addressLine2?: string; city: string; state: string; postalCode: string }

export interface InvOrder {
  id: string; orderNumber: string; status: string; fulfillmentStatus: string; orderDate: string; dueDate?: string
  customerPoNumber?: string
  customer: { id: string; companyName: string; paymentTerms: string }
  items: InvOrderItem[]
  serialAssignments?: InvSerialAssignment[]
  shippingAddress: InvAddress | null
  billingAddress: InvAddress | null
  subtotal: number; discountPct: number; discountAmt: number
  taxRate: number; taxAmt: number; shippingCost: number
  total: number; paidAmount: number; balance: number
  notes?: string; internalNotes?: string
  invoiceNumber?: string; invoicedAt?: string
  shipCarrier?: string; shipTracking?: string; shippedAt?: string
}

const TERMS_LABEL: Record<string, string> = {
  NET_15: 'Net 15', NET_30: 'Net 30', NET_60: 'Net 60',
  NET_90: 'Net 90', DUE_ON_RECEIPT: 'Due on Receipt',
}

function addrLines(a: InvAddress | null): string[] {
  if (!a) return []
  return [
    a.addressLine1,
    ...(a.addressLine2 ? [a.addressLine2] : []),
    `${a.city}, ${a.state} ${a.postalCode}`,
  ]
}

export function generateInvoicePDF(order: InvOrder, returnBuffer?: boolean): Buffer | void {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  const margin = 48
  const right = w - margin
  const isPaid = order.status === 'PAID'
  const $ = (n: number) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  // Brand colors
  const blue: [number, number, number] = [27, 94, 166]
  const red: [number, number, number] = [193, 52, 44]
  const navy: [number, number, number] = [27, 58, 92]
  const gray50: [number, number, number] = [249, 250, 251]
  const gray200: [number, number, number] = [229, 231, 235]
  const gray500: [number, number, number] = [107, 114, 128]
  const gray700: [number, number, number] = [55, 65, 81]
  const black: [number, number, number] = [17, 24, 39]

  let y = 0

  function ensureSpace(needed: number) {
    if (y + needed > h - 60) {
      doc.addPage()
      y = margin
    }
  }

  // ─── Header: Stacked logo ──────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  const olCharSpace = 2.5
  const olBaseW = doc.getTextWidth('OPEN LINE')
  const olFullW = olBaseW + ('OPEN LINE'.length - 1) * olCharSpace

  doc.setFontSize(9)
  const mCharSpace = 4
  const mBaseW = doc.getTextWidth('MOBILITY')
  const mFullW = mBaseW + ('MOBILITY'.length - 1) * mCharSpace

  const blockW = Math.max(olFullW, mFullW)
  const blockCx = margin + blockW / 2

  const sc = 0.4
  const iconW = (220 - 50) * sc
  const iconCx = blockCx
  const logoOx = iconCx - (135 * sc)
  const logoOy = 8

  const p0x = 60*sc+logoOx, p0y = 105*sc+logoOy
  const c1x = 100*sc+logoOx, c1y = 120*sc+logoOy
  const c2x = 160*sc+logoOx, c2y = 40*sc+logoOy
  const p3x = 210*sc+logoOx, p3y = 55*sc+logoOy

  doc.setLineWidth(1.5)
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
  void iconW

  const ldx = 58*sc+logoOx, ldy = 104*sc+logoOy
  doc.setDrawColor(...blue); doc.setLineWidth(1.6)
  doc.circle(ldx, ldy, 4.5, 'S')
  doc.setFillColor(...blue); doc.circle(ldx, ldy, 1.5, 'F')

  const rdx = 212*sc+logoOx, rdy = 54*sc+logoOy
  doc.setDrawColor(...red); doc.setLineWidth(1.6)
  doc.circle(rdx, rdy, 5, 'S')
  doc.setFillColor(...red); doc.circle(rdx, rdy, 1.6, 'F')

  const textY = Math.max(ldy, rdy) + 22
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...navy)
  doc.text('OPEN LINE', blockCx - olFullW / 2, textY, { charSpace: olCharSpace })

  doc.setFontSize(9); doc.setTextColor(...red)
  doc.text('MOBILITY', blockCx - mFullW / 2, textY + 13, { charSpace: mCharSpace })

  const logoBottom = textY + 22

  // Invoice title block (right side)
  doc.setFontSize(24); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
  doc.text('INVOICE', right, 42, { align: 'right' })
  doc.setDrawColor(...blue); doc.setLineWidth(2)
  doc.line(right - 100, 48, right - 30, 48)
  doc.setDrawColor(...red); doc.setLineWidth(2)
  doc.line(right - 30, 48, right, 48)

  // ─── Invoice meta (right column) ──────────────────────────────────
  y = 68
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

  doc.setFillColor(...navy)
  doc.roundedRect(margin, y - 12, right - margin, 18, 4, 4, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255)
  doc.text('ITEM', margin + 8, y)
  doc.text('QTY', right - 145, y, { align: 'right' })
  doc.text('UNIT PRICE', right - 65, y, { align: 'right' })
  doc.text('AMOUNT', right - 6, y, { align: 'right' })
  y += 14

  const rowHeight = 28
  order.items.forEach((item, i) => {
    ensureSpace(rowHeight + 4)
    if (i % 2 === 0) {
      doc.setFillColor(...gray50)
      doc.roundedRect(margin, y - 10, right - margin, rowHeight, 2, 2, 'F')
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...navy)
    const skuLabel = item.sku ? item.sku : (item.isInvoiceAddon ? 'ADD-ON' : '—')
    doc.text(skuLabel, margin + 8, y)
    doc.setTextColor(...black)
    doc.text(String(Number(item.quantity)), right - 145, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.text($(item.unitPrice), right - 65, y, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text($(item.total), right - 6, y, { align: 'right' })
    y += 11
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...gray500)
    const titleStr = item.isInvoiceAddon ? `* ${item.title}` : item.title
    doc.text(titleStr.substring(0, 70), margin + 8, y)
    y += rowHeight - 11 + 4
  })

  doc.setDrawColor(...gray200); doc.setLineWidth(0.5)
  doc.line(margin, y - 6, right, y - 6)

  // ─── Shipping Info ────────────────────────────────────────────────
  if (order.shipCarrier || order.shipTracking) {
    y += 10
    ensureSpace(60)

    const gridTop = y
    const gridH = 36
    const gridW = right - margin
    const colW = gridW / 3

    doc.setDrawColor(...gray200); doc.setLineWidth(0.6)
    doc.roundedRect(margin, gridTop, gridW, gridH, 3, 3, 'S')

    doc.setFillColor(...navy)
    doc.roundedRect(margin, gridTop, gridW, 13, 3, 3, 'F')
    doc.rect(margin, gridTop + 6, gridW, 7, 'F')

    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(255, 255, 255)
    doc.text('SHIPPING DETAILS', margin + 8, gridTop + 9)

    doc.setDrawColor(...gray200); doc.setLineWidth(0.4)
    doc.line(margin + colW, gridTop + 13, margin + colW, gridTop + gridH)
    doc.line(margin + colW * 2, gridTop + 13, margin + colW * 2, gridTop + gridH)

    const cellY = gridTop + 21
    const cells: [number, string, string][] = [
      [margin + 8, 'Carrier', order.shipCarrier || '—'],
      [margin + colW + 8, 'Tracking #', order.shipTracking || '—'],
      [margin + colW * 2 + 8, 'Ship Date', order.shippedAt ? new Date(order.shippedAt).toLocaleDateString() : '—'],
    ]
    cells.forEach(([x, label, value]) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(...gray500)
      doc.text(label.toUpperCase(), x, cellY)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...black)
      doc.text(value, x, cellY + 9)
    })

    y = gridTop + gridH + 4
  }

  // ─── Totals block ─────────────────────────────────────────────────
  y += 8
  const totalsX = right - 180
  ensureSpace(90)

  const summaryRows: [string, string][] = [
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

  doc.setFillColor(...navy)
  doc.roundedRect(totalsX - 6, y - 10, right - totalsX + 12, 20, 4, 4, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255)
  doc.text('TOTAL DUE', totalsX, y + 2)
  doc.text($(order.total), right - 6, y + 2, { align: 'right' })
  y += 26

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...gray500)
  doc.text('Amount Paid', totalsX, y)
  doc.setTextColor(22, 163, 74)
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

  // ─── Serial Numbers Section ───────────────────────────────────────
  if (order.serialAssignments && order.serialAssignments.length > 0) {
    doc.addPage()
    y = margin

    doc.setFillColor(...navy)
    doc.roundedRect(margin, y - 10, right - margin, 18, 4, 4, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255)
    doc.text('SERIAL NUMBERS', margin + 8, y + 1)
    y += 16

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
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...navy)
      doc.text(`${group.sku}`, margin + 8, y)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray700)
      doc.text(`— ${group.title}`, margin + 8 + doc.getTextWidth(group.sku + '  '), y)
      y += 12

      const colCount = 4
      const colWidth = (right - margin - 16) / colCount
      const serialRowH = 8
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...black)
      group.serials.forEach((sn, si) => {
        const col = si % colCount
        const row = Math.floor(si / colCount)
        if (col === 0 && row > 0) y += serialRowH
        if (col === 0) ensureSpace(serialRowH + 4)
        const sx = margin + 12 + col * colWidth
        doc.text(sn, sx, y)
      })
      y += serialRowH + 8
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

  if (returnBuffer) return Buffer.from(doc.output('arraybuffer'))
  doc.save(`Invoice-${invRef}.pdf`)
}
