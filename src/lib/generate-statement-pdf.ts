import jsPDF from 'jspdf'

export interface StatementLine {
  date: string
  type: 'INVOICE' | 'PAYMENT' | 'CREDIT_MEMO'
  reference: string
  invoiceNumber: string | null
  charges: number
  credits: number
  applied: number
  remaining: number
  balance: number
  paymentId?: string
}

export interface StatementCustomer {
  id: string
  companyName: string
  contactName?: string
}

function fmtUSD(n: number) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function generateStatementPDF(
  customer: StatementCustomer,
  lines: StatementLine[],
  openBalance: number,
  viewType: 'activity' | 'open' = 'activity',
  returnBuffer?: boolean,
): Buffer | void {
  const isOpen = viewType === 'open'
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  const margin = 48
  const right = w - margin

  // Brand colors
  const blue: [number, number, number] = [27, 94, 166]
  const red: [number, number, number] = [193, 52, 44]
  const navy: [number, number, number] = [27, 58, 92]
  const gray50: [number, number, number] = [249, 250, 251]
  const gray200: [number, number, number] = [229, 231, 235]
  const gray500: [number, number, number] = [107, 114, 128]
  const gray700: [number, number, number] = [55, 65, 81]

  // ─── Logo ───────────────────────────────────────────────────────────
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

  // Title
  doc.setFontSize(24); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
  doc.text(isOpen ? 'OPEN STATEMENT' : 'STATEMENT', right, 42, { align: 'right' })
  doc.setDrawColor(...blue); doc.setLineWidth(2)
  doc.line(right - 130, 48, right - 30, 48)
  doc.setDrawColor(...red); doc.setLineWidth(2)
  doc.line(right - 30, 48, right, 48)

  // Meta (right)
  let y = 68
  doc.setFontSize(8.5)
  const metaRows: [string, string][] = [
    ['Date', new Date().toLocaleDateString()],
    ['Open Balance', fmtUSD(openBalance)],
  ]
  metaRows.forEach(([label, val]) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
    doc.text(label, right - 120, y)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text(val, right, y, { align: 'right' })
    y += 14
  })

  // Customer info
  const logoBottom = textY + 28
  y = Math.max(y + 10, logoBottom + 10)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
  doc.text('CUSTOMER', margin, y)
  y += 14
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
  doc.text(customer.companyName, margin, y)
  if (customer.contactName) {
    y += 14
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray700)
    doc.text(customer.contactName, margin, y)
  }
  y += 24

  // Table header
  doc.setFillColor(...gray50)
  doc.rect(margin, y - 12, right - margin, 18, 'F')
  doc.setDrawColor(...gray200); doc.setLineWidth(0.5)
  doc.line(margin, y + 6, right, y + 6)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...gray500)
  doc.text('DATE', margin + 8, y)
  doc.text('TYPE', margin + 70, y)
  doc.text('REFERENCE', margin + 140, y)
  doc.text('DOCUMENT #', margin + 230, y)
  doc.text('CHARGES', right - 190, y, { align: 'right' })
  doc.text('CREDITS', right - 125, y, { align: 'right' })
  doc.text('APPLIED', right - 62, y, { align: 'right' })
  doc.text('BALANCE', right - 8, y, { align: 'right' })
  y += 18

  const typeLabel: Record<string, string> = { INVOICE: 'Invoice', PAYMENT: 'Payment', CREDIT_MEMO: 'Credit Memo' }
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal')
  for (const line of lines) {
    if (y > h - 80) { doc.addPage(); y = margin }
    doc.setTextColor(...gray700)
    doc.text(new Date(line.date).toLocaleDateString(), margin + 8, y)
    doc.text(typeLabel[line.type] ?? line.type, margin + 70, y)
    doc.text(line.reference.substring(0, 16), margin + 140, y)
    doc.text((line.invoiceNumber ?? '').substring(0, 14), margin + 230, y)
    doc.text(line.charges > 0 ? fmtUSD(line.charges) : '', right - 190, y, { align: 'right' })
    if (line.credits > 0) {
      doc.setTextColor(22, 163, 74)
      doc.text(fmtUSD(line.credits), right - 125, y, { align: 'right' })
      doc.setTextColor(...gray700)
    } else {
      doc.text('', right - 125, y, { align: 'right' })
    }
    doc.text(Number(line.applied) > 0 ? fmtUSD(line.applied) : '', right - 62, y, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    const balVal = isOpen ? line.remaining : line.balance
    doc.text(fmtUSD(balVal), right - 8, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 6
    doc.setDrawColor(...gray200); doc.setLineWidth(0.3)
    doc.line(margin, y, right, y)
    y += 14
  }

  // Total
  y += 8
  doc.setDrawColor(...navy); doc.setLineWidth(1)
  doc.line(right - 200, y - 2, right, y - 2)
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
  doc.text('Total Balance Due:', right - 200, y + 12)
  doc.text(fmtUSD(openBalance), right - 8, y + 12, { align: 'right' })

  if (returnBuffer) return Buffer.from(doc.output('arraybuffer'))
  const prefix = isOpen ? 'Open-Statement' : 'Statement'
  doc.save(`${prefix}-${customer.companyName.replace(/\s+/g, '-')}.pdf`)
}
