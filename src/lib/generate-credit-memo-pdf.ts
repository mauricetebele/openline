import jsPDF from 'jspdf'

interface CreditMemoSerial {
  serialNumber: string
  sku: string
  salePrice: number
}

export interface CreditMemoPDFData {
  memoNumber: string
  createdAt: string
  customerName: string
  rmaNumber: string
  billingAddress?: { addressLine1: string; addressLine2?: string | null; city: string; state: string; postalCode: string } | null
  serials: CreditMemoSerial[]
  subtotal: number
  restockingFee: number
  total: number
  notes: string | null
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

export async function generateCreditMemoPDF(data: CreditMemoPDFData) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  const margin = 48
  const right = w - margin

  // Brand colors (match invoice)
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

  // ─── Header: Stacked logo (matching invoice) ──────────────────────
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

  // ─── Title block (right side) ─────────────────────────────────────
  doc.setFontSize(24); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
  doc.text('CREDIT MEMO', right, 42, { align: 'right' })
  doc.setDrawColor(...blue); doc.setLineWidth(2)
  doc.line(right - 130, 48, right - 30, 48)
  doc.setDrawColor(...red); doc.setLineWidth(2)
  doc.line(right - 30, 48, right, 48)

  // ─── Meta (right column) ──────────────────────────────────────────
  y = 68
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
  const metaRows: [string, string][] = [
    ['Credit Memo #', data.memoNumber || '—'],
    ['Date', data.createdAt ? fmtDate(data.createdAt) : '—'],
    ['RMA #', data.rmaNumber || '—'],
  ]

  metaRows.forEach(([label, val]) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
    doc.text(label, right - 130, y)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text(val, right, y, { align: 'right' })
    y += 13
  })

  // ─── Customer / Billing Address ───────────────────────────────────
  y = Math.max(logoBottom, y + 6)

  doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...blue)
  doc.text('CUSTOMER', margin, y)
  y += 4
  doc.setDrawColor(...blue); doc.setLineWidth(0.8)
  doc.line(margin, y, margin + 60, y)
  y += 12

  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...black)
  doc.text(data.customerName || '—', margin, y)
  y += 13

  if (data.billingAddress) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...gray700)
    doc.text(data.billingAddress.addressLine1 || '', margin, y)
    y += 12
    if (data.billingAddress.addressLine2) {
      doc.text(data.billingAddress.addressLine2, margin, y)
      y += 12
    }
    doc.text(`${data.billingAddress.city || ''}, ${data.billingAddress.state || ''} ${data.billingAddress.postalCode || ''}`, margin, y)
    y += 12
  }

  // ─── Bold RMA reference ──────────────────────────────────────────
  y += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...navy)
  doc.text(`RMA: ${data.rmaNumber || '—'}`, margin, y)
  y += 20

  // ─── Line items table (no grade column) ───────────────────────────
  if (data.serials.length > 0) {
    const cols = [
      { label: 'SERIAL #',   x: margin + 8,   align: 'left' as const },
      { label: 'SKU',        x: margin + 180,  align: 'left' as const },
      { label: 'SALE PRICE', x: right - 8,     align: 'right' as const },
    ]

    ensureSpace(30)
    doc.setFillColor(...navy)
    doc.roundedRect(margin, y - 12, right - margin, 18, 4, 4, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255)
    for (const col of cols) {
      doc.text(col.label, col.x, y, { align: col.align })
    }
    y += 14

    doc.setTextColor(...black)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)

    data.serials.forEach((s, i) => {
      ensureSpace(18)
      if (i % 2 === 0) {
        doc.setFillColor(...gray50)
        doc.roundedRect(margin, y - 10, right - margin, 16, 2, 2, 'F')
      }
      doc.setTextColor(...black)
      doc.text(s.serialNumber || '—', cols[0].x, y)
      doc.setTextColor(...gray700)
      doc.text(s.sku || '—', cols[1].x, y)
      doc.setTextColor(...black)
      doc.text(s.salePrice > 0 ? `$${s.salePrice.toFixed(2)}` : '—', cols[2].x, y, { align: 'right' })
      y += 16
    })

    // ── Totals
    y += 8
    const totalsX = right - 180
    ensureSpace(70)

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...gray500)
    doc.text('Subtotal', totalsX, y)
    doc.setTextColor(...black)
    doc.text(`$${data.subtotal.toFixed(2)}`, right - 6, y, { align: 'right' })
    y += 14

    if (data.restockingFee > 0) {
      doc.setTextColor(...gray500)
      doc.text('Restocking Fee', totalsX, y)
      doc.setTextColor(...red)
      doc.text(`-$${data.restockingFee.toFixed(2)}`, right - 6, y, { align: 'right' })
      y += 14
    }

    // Credit total — highlighted
    doc.setFillColor(20, 120, 60)
    doc.roundedRect(totalsX - 6, y - 10, right - totalsX + 12, 20, 4, 4, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255)
    doc.text('CREDIT TOTAL', totalsX, y + 2)
    doc.text(`$${data.total.toFixed(2)}`, right - 6, y + 2, { align: 'right' })
    y += 30
  }

  // ── Notes
  if (data.notes && typeof data.notes === 'string') {
    y += 6
    ensureSpace(40)
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...blue)
    doc.text('NOTES', margin, y)
    y += 3
    doc.setDrawColor(...blue); doc.setLineWidth(0.5)
    doc.line(margin, y, margin + 35, y)
    y += 10
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...gray700)
    const noteLines = doc.splitTextToSize(data.notes, right - margin)
    doc.text(noteLines, margin, y)
  }

  // ── Footer
  const footY = h - 36
  doc.setDrawColor(...gray200); doc.setLineWidth(0.5)
  doc.line(margin, footY - 8, right, footY - 8)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...gray500)
  doc.text('Open Line Mobility, Ltd.', margin, footY)
  doc.text('Thank you for your business.', w / 2, footY, { align: 'center' })
  doc.text(data.memoNumber || '', right, footY, { align: 'right' })

  doc.save(`CreditMemo-${data.memoNumber}.pdf`)
}
