import jsPDF from 'jspdf'

export interface ReceiptPayment {
  paymentNumber: string
  paymentDate: string
  amount: number
  method: string
  reference?: string
  memo?: string
  unallocated: number
  customer: { companyName: string }
  allocations: {
    amount: number
    createdAt: string
    order: { orderNumber: string; invoiceNumber?: string }
  }[]
}

const METHOD_LABEL: Record<string, string> = {
  CHECK: 'Check', ACH: 'ACH', WIRE: 'Wire', CREDIT_CARD: 'Credit Card',
  CASH: 'Cash', ZELLE: 'Zelle', OTHER: 'Other',
}

export function generatePaymentReceiptPDF(payment: ReceiptPayment) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()
  const margin = 48
  const right = w - margin
  const $ = (n: number) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  // Brand colors
  const blue: [number, number, number] = [27, 94, 166]
  const red: [number, number, number] = [193, 52, 44]
  const navy: [number, number, number] = [27, 58, 92]
  const gray50: [number, number, number] = [249, 250, 251]
  const gray200: [number, number, number] = [229, 231, 235]
  const gray500: [number, number, number] = [107, 114, 128]
  const gray700: [number, number, number] = [55, 65, 81]

  let y = 0

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
  const iconCx = blockCx
  void iconCx
  const logoOx = blockCx - (135 * sc)
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

  // Title (right side)
  doc.setFontSize(24); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
  doc.text('PAYMENT RECEIPT', right, 42, { align: 'right' })
  doc.setDrawColor(...blue); doc.setLineWidth(2)
  doc.line(right - 160, 48, right - 30, 48)
  doc.setDrawColor(...red); doc.setLineWidth(2)
  doc.line(right - 30, 48, right, 48)

  // ─── Payment meta (right column) ────────────────────────────────────
  y = 68
  doc.setFontSize(8.5)
  const metaRows: [string, string][] = [
    ['Payment #', payment.paymentNumber],
    ['Date', new Date(payment.paymentDate).toLocaleDateString()],
    ['Method', METHOD_LABEL[payment.method] ?? payment.method],
    ['Amount', $(Number(payment.amount))],
  ]
  if (payment.reference) metaRows.push(['Reference', payment.reference])
  if (payment.memo) metaRows.push(['Memo', payment.memo])

  metaRows.forEach(([label, val]) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
    doc.text(label, right - 140, y)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text(val, right, y, { align: 'right' })
    y += 14
  })

  // ─── Customer info ──────────────────────────────────────────────────
  const logoBottom = textY + 28
  y = Math.max(y + 10, logoBottom + 10)

  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
  doc.text('RECEIVED FROM', margin, y)
  y += 14
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
  doc.text(payment.customer.companyName, margin, y)
  y += 28

  // ─── Summary bar ────────────────────────────────────────────────────
  const allocated = Number(payment.amount) - Number(payment.unallocated)
  doc.setFillColor(...gray50)
  doc.roundedRect(margin, y, right - margin, 44, 4, 4, 'F')
  doc.setDrawColor(...gray200); doc.setLineWidth(0.5)
  doc.roundedRect(margin, y, right - margin, 44, 4, 4, 'S')

  const colW = (right - margin) / 3
  const sumY = y + 16
  const valY = y + 32

  const summaryItems = [
    { label: 'TOTAL', value: $(Number(payment.amount)) },
    { label: 'ALLOCATED', value: $(allocated) },
    { label: 'UNALLOCATED', value: $(Number(payment.unallocated)) },
  ]
  summaryItems.forEach((item, i) => {
    const cx = margin + colW * i + colW / 2
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
    doc.text(item.label, cx, sumY, { align: 'center' })
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text(item.value, cx, valY, { align: 'center' })
  })

  y += 62

  // ─── Allocations table ──────────────────────────────────────────────
  if (payment.allocations.length > 0) {
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('Applied to Invoices', margin, y)
    y += 18

    // Table header
    doc.setFillColor(...gray50)
    doc.rect(margin, y - 12, right - margin, 18, 'F')
    doc.setDrawColor(...gray200); doc.setLineWidth(0.5)
    doc.line(margin, y + 6, right, y + 6)

    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...gray500)
    doc.text('INVOICE', margin + 8, y)
    doc.text('AMOUNT APPLIED', right - 130, y, { align: 'right' })
    doc.text('DATE APPLIED', right - 8, y, { align: 'right' })
    y += 18

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    for (const alloc of payment.allocations) {
      doc.setTextColor(...gray700)
      doc.text(alloc.order.invoiceNumber ?? alloc.order.orderNumber, margin + 8, y)
      doc.setFont('helvetica', 'bold')
      doc.text($(Number(alloc.amount)), right - 130, y, { align: 'right' })
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
      doc.text(new Date(alloc.createdAt).toLocaleDateString(), right - 8, y, { align: 'right' })

      y += 16
      doc.setDrawColor(...gray200); doc.setLineWidth(0.3)
      doc.line(margin, y - 4, right, y - 4)
    }

    // Allocations total
    y += 4
    doc.setDrawColor(...navy); doc.setLineWidth(1)
    doc.line(right - 180, y - 2, right, y - 2)
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('Total Applied', right - 180, y + 10)
    doc.text($(allocated), right - 130, y + 10, { align: 'right' })
  }

  // ─── Footer ─────────────────────────────────────────────────────────
  const footerY = doc.internal.pageSize.getHeight() - 40
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
  doc.text('Thank you for your payment.', w / 2, footerY, { align: 'center' })

  doc.save(`Payment-${payment.paymentNumber}.pdf`)
}
