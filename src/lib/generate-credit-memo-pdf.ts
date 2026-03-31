import jsPDF from 'jspdf'

interface CreditMemoSerial {
  serialNumber: string
  sku: string
  grade: string | null
  salePrice: number
}

interface CreditMemoAllocation {
  orderNumber: string
  amount: number
}

export interface CreditMemoPDFData {
  memoNumber: string
  createdAt: string
  customerName: string
  rmaNumber: string
  serials: CreditMemoSerial[]
  subtotal: number
  restockingFee: number
  total: number
  allocations: CreditMemoAllocation[]
  notes: string | null
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

export async function generateCreditMemoPDF(data: CreditMemoPDFData) {
  // Fetch store settings
  let store = {
    storeName: 'Open Line Mobility', logoBase64: null as string | null,
    phone: null as string | null, email: null as string | null,
    addressLine: null as string | null, city: null as string | null,
    state: null as string | null, zip: null as string | null,
  }
  try {
    const res = await fetch('/api/store-settings')
    if (res.ok) store = { ...store, ...(await res.json()) }
  } catch { /* defaults */ }

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()
  const margin = 45
  const right = w - margin
  const cw = right - margin
  let y = margin

  // ── Header
  doc.setFillColor(20, 40, 75)
  doc.rect(0, 0, w, 70, 'F')

  if (store.logoBase64) {
    try { doc.addImage(store.logoBase64, 'PNG', margin, 12, 44, 44) } catch { /* skip */ }
  }

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('CREDIT MEMO', store.logoBase64 ? margin + 52 : margin, 38)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(store.storeName, store.logoBase64 ? margin + 52 : margin, 52)

  doc.setFontSize(11)
  doc.text(data.memoNumber, right, 38, { align: 'right' })
  doc.setFontSize(8)
  doc.text(fmtDate(data.createdAt), right, 52, { align: 'right' })

  y = 90

  // ── Info box
  doc.setTextColor(60, 60, 60)
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.5)
  doc.roundedRect(margin, y, cw, 50, 4, 4, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Customer', margin + 10, y + 15)
  doc.text('RMA Reference', margin + cw / 2, y + 15)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(data.customerName, margin + 10, y + 30)
  doc.text(data.rmaNumber, margin + cw / 2, y + 30)

  y += 65

  // ── Line items table
  if (data.serials.length > 0) {
    const cols = [
      { label: 'SERIAL #',   x: margin + 8,   align: 'left' as const },
      { label: 'SKU',        x: margin + 140,  align: 'left' as const },
      { label: 'GRADE',      x: margin + 280,  align: 'left' as const },
      { label: 'SALE PRICE', x: right - 8,     align: 'right' as const },
    ]

    doc.setFillColor(20, 40, 75)
    doc.roundedRect(margin, y, cw, 18, 3, 3, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    y += 12
    for (const col of cols) {
      doc.text(col.label, col.x, y, { align: col.align })
    }
    y += 12

    doc.setTextColor(50, 50, 50)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)

    data.serials.forEach((s, i) => {
      if (y > doc.internal.pageSize.getHeight() - 140) {
        doc.addPage()
        y = margin
      }
      if (i % 2 === 0) {
        doc.setFillColor(245, 247, 250)
        doc.rect(margin, y - 10, cw, 16, 'F')
      }
      doc.text(s.serialNumber, cols[0].x, y)
      doc.text(s.sku, cols[1].x, y)
      doc.text(s.grade ?? '—', cols[2].x, y)
      doc.text(s.salePrice > 0 ? `$${s.salePrice.toFixed(2)}` : '—', cols[3].x, y, { align: 'right' })
      y += 16
    })

    // ── Totals
    y += 8
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.5)
    doc.line(margin + cw * 0.55, y, right, y)
    y += 14

    const labelX = margin + cw * 0.6
    const valX = right - 8

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text('Subtotal:', labelX, y)
    doc.text(`$${data.subtotal.toFixed(2)}`, valX, y, { align: 'right' })
    y += 14

    if (data.restockingFee > 0) {
      doc.text('Restocking Fee:', labelX, y)
      doc.setTextColor(180, 50, 50)
      doc.text(`-$${data.restockingFee.toFixed(2)}`, valX, y, { align: 'right' })
      doc.setTextColor(50, 50, 50)
      y += 14
    }

    doc.setDrawColor(20, 40, 75)
    doc.setLineWidth(1)
    doc.line(margin + cw * 0.55, y - 4, right, y - 4)
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(20, 120, 60)
    doc.text('Credit Total:', labelX, y)
    doc.text(`$${data.total.toFixed(2)}`, valX, y, { align: 'right' })
    y += 24
    doc.setTextColor(50, 50, 50)
  }

  // ── Invoice allocations
  if (data.allocations.length > 0) {
    if (y > doc.internal.pageSize.getHeight() - 100) {
      doc.addPage()
      y = margin
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('Applied to Invoices:', margin, y)
    y += 14

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    for (const alloc of data.allocations) {
      doc.text(alloc.orderNumber, margin + 10, y)
      doc.text(`$${alloc.amount.toFixed(2)}`, margin + 160, y, { align: 'right' })
      y += 14
    }
    y += 6
  }

  // ── Notes
  if (data.notes) {
    if (y > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage()
      y = margin
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('Notes:', margin, y)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(data.notes, cw - 10)
    doc.text(lines, margin, y + 12)
  }

  // ── Footer
  y = doc.internal.pageSize.getHeight() - 50
  doc.setFillColor(240, 245, 255)
  doc.setDrawColor(20, 40, 75)
  doc.setLineWidth(1)
  doc.roundedRect(margin, y, cw, 36, 4, 4, 'FD')
  doc.setTextColor(20, 40, 75)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const footerParts = [store.storeName, store.phone, store.email].filter(Boolean)
  doc.text(footerParts.join('  |  '), margin + 10, y + 22)

  doc.save(`CreditMemo-${data.memoNumber}.pdf`)
}
