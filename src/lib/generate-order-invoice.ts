import jsPDF from 'jspdf'

// ─── Types (mirrors the Order shape from UnshippedOrders) ─────────────────────

interface InvoiceOrderItem {
  id: string
  orderItemId: string
  sellerSku: string | null
  title: string | null
  quantityOrdered: number
  itemPrice: string | null
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(amount: string | null, currency?: string | null): string {
  if (!amount) return '$0.00'
  const num = parseFloat(amount)
  return isNaN(num) ? '$0.00' : `$${num.toFixed(2)}`
}

function addrLines(order: InvoiceOrder): string[] {
  const lines: string[] = []
  if (order.shipToName) lines.push(order.shipToName)
  if (order.shipToAddress1) lines.push(order.shipToAddress1)
  if (order.shipToAddress2) lines.push(order.shipToAddress2)
  const cityStateZip = [
    order.shipToCity,
    order.shipToState ? `${order.shipToState} ${order.shipToPostal ?? ''}`.trim() : order.shipToPostal,
  ].filter(Boolean).join(', ')
  if (cityStateZip) lines.push(cityStateZip)
  if (order.shipToCountry && order.shipToCountry !== 'US') lines.push(order.shipToCountry)
  return lines
}

// ─── PDF Generator ────────────────────────────────────────────────────────────

export function generateOrderInvoicePDF(order: InvoiceOrder) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()

  // Build serial map: orderItemId → serialNumber[]
  const serialMap = new Map<string, string[]>()
  if (order.serialAssignments) {
    for (const sa of order.serialAssignments) {
      const list = serialMap.get(sa.orderItemId) ?? []
      list.push(sa.inventorySerial.serialNumber)
      serialMap.set(sa.orderItemId, list)
    }
  }

  // ── Header ─────────────────────────────────────────────────────────────────
  // Company branding
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(27, 58, 92) // Navy blue
  doc.text('OPEN LINE', 40, 38)
  doc.setFontSize(10)
  doc.setTextColor(193, 52, 44) // Red
  doc.text('MOBILITY', 40, 52)
  doc.setTextColor(0, 0, 0)

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('INVOICE', 40, 76)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const orderRef = order.olmNumber ? `OLM-${order.olmNumber}` : order.amazonOrderId
  doc.text(`Invoice: ${orderRef}`, w - 40, 38, { align: 'right' })
  doc.text(`Amazon Order: ${order.amazonOrderId}`, w - 40, 53, { align: 'right' })
  doc.text(`Date: ${new Date(order.purchaseDate).toLocaleDateString()}`, w - 40, 68, { align: 'right' })

  // ── Ship To ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.text('Ship To:', 40, 110)
  doc.setFont('helvetica', 'normal')

  const shipLines = addrLines(order)
  let y = 124
  for (const line of shipLines) {
    doc.text(line, 40, y)
    y += 14
  }

  // ── Items Table ────────────────────────────────────────────────────────────
  y = Math.max(y + 20, 170)
  doc.setFillColor(245, 245, 245)
  doc.rect(40, y - 14, w - 80, 18, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('SKU', 45, y)
  doc.text('Product', 150, y)
  doc.text('Qty', 380, y, { align: 'right' })
  doc.text('Serial #', 400, y)
  doc.text('Price', w - 45, y, { align: 'right' })
  y += 18

  doc.setFont('helvetica', 'normal')
  let itemSubtotal = 0

  for (const item of order.items) {
    const price = item.itemPrice ? parseFloat(item.itemPrice) * item.quantityOrdered : 0
    itemSubtotal += price
    const serials = serialMap.get(item.orderItemId) ?? []

    doc.text(item.sellerSku ?? '—', 45, y)
    doc.text((item.title ?? '—').substring(0, 35), 150, y)
    doc.text(String(item.quantityOrdered), 380, y, { align: 'right' })
    doc.text(serials.length > 0 ? serials[0] : '—', 400, y)
    doc.text(fmt(String(price)), w - 45, y, { align: 'right' })
    y += 16

    // Additional serial numbers on subsequent lines
    for (let i = 1; i < serials.length; i++) {
      doc.setFontSize(8)
      doc.setTextColor(100, 100, 100)
      doc.text(serials[i], 400, y)
      doc.setFontSize(9)
      doc.setTextColor(0, 0, 0)
      y += 14
    }

    // Page break check
    if (y > 700) {
      doc.addPage()
      y = 50
    }
  }

  // ── Shipping Info ──────────────────────────────────────────────────────────
  if (order.label) {
    y += 10
    doc.setLineWidth(0.5)
    doc.setDrawColor(200, 200, 200)
    doc.line(40, y, w - 40, y)
    y += 18

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('Shipping', 40, y)
    y += 16

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    if (order.label.carrier) { doc.text(`Carrier: ${order.label.carrier}`, 40, y); y += 14 }
    if (order.label.serviceCode) { doc.text(`Service: ${order.label.serviceCode}`, 40, y); y += 14 }
    doc.text(`Tracking: ${order.label.trackingNumber}`, 40, y); y += 14
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  y += 10
  doc.setLineWidth(0.5)
  doc.setDrawColor(0, 0, 0)
  doc.line(w - 220, y, w - 45, y)
  y += 16

  const shippingCost = order.label?.shipmentCost ? parseFloat(order.label.shipmentCost) : 0
  const orderTotalNum = order.orderTotal ? parseFloat(order.orderTotal) : itemSubtotal + shippingCost

  doc.setFontSize(9)
  doc.text('Item Subtotal:', w - 220, y)
  doc.text(fmt(String(itemSubtotal)), w - 45, y, { align: 'right' })
  y += 16

  if (shippingCost > 0) {
    doc.text('Shipping:', w - 220, y)
    doc.text(fmt(String(shippingCost)), w - 45, y, { align: 'right' })
    y += 16
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('ORDER TOTAL:', w - 220, y)
  doc.text(fmt(String(orderTotalNum)), w - 45, y, { align: 'right' })

  // ── Footer ─────────────────────────────────────────────────────────────────
  const pageH = doc.internal.pageSize.getHeight()
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(150, 150, 150)
  doc.text(`Generated ${new Date().toLocaleDateString()}`, 40, pageH - 30)

  // Save
  const filename = order.olmNumber ? `Invoice-OLM-${order.olmNumber}.pdf` : `Invoice-${order.amazonOrderId}.pdf`
  doc.save(filename)
}
