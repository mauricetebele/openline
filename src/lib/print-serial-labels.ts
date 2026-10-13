import { jsPDF } from 'jspdf'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { printPdfBase64 } from '@/lib/print-pdf'

export interface SerialLabelItem {
  serialNumber: string
  sku: string | null
  grade?: string | null
  /** Optional TRG ID — when present, printed as a QR code (with its digits
   *  underneath) alongside the serial barcode. */
  trgId?: string | null
}

// DYMO 30334 = 2.25" × 1.25"
const W = 2.25 * 72 // points
const H = 1.25 * 72 // points
const MARGIN = 4

export function labelTimestamp(): string {
  return new Date().toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', year: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

/**
 * Render ONE serial label onto the current page of `doc`. Layout: SKU (bold),
 * grade, a CODE128 barcode of the serial with the serial underneath, and a
 * bottom-right timestamp. When the item has a TRG ID, the serial barcode is
 * narrowed to the left and the TRG ID is printed on the right as a QR code with
 * its digits underneath. Client-only (uses <canvas> for the barcode).
 */
export async function drawSerialLabel(doc: jsPDF, item: SerialLabelItem): Promise<void> {
  const maxTextW = W - MARGIN * 2
  const timestamp = labelTimestamp()
  const hasTrg = !!(item.trgId && item.trgId.trim())

  // SKU line (bold) — shrink to fit.
  const sku = item.sku ?? ''
  doc.setFont('helvetica', 'bold')
  let skuSize = 10
  doc.setFontSize(skuSize)
  while (skuSize > 5 && doc.getTextWidth(sku) > maxTextW) { skuSize -= 0.5; doc.setFontSize(skuSize) }
  if (sku) doc.text(sku, MARGIN, 12)

  // Grade line (bold, only if present).
  let yAfterGrade = 12
  if (item.grade) {
    yAfterGrade = 22
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(item.grade, MARGIN, yAfterGrade)
  }

  // Serial barcode (CODE128) rendered at 4× for a crisp PDF.
  const scale = 4
  const canvas = document.createElement('canvas')
  JsBarcode(canvas, item.serialNumber, { format: 'CODE128', width: 2 * scale, height: 40 * scale, displayValue: false, margin: 0 })
  const barcodeImg = canvas.toDataURL('image/png')
  const barcodeY = yAfterGrade + 6

  if (hasTrg) {
    const trg = item.trgId!.trim()
    const qrSize = 42
    const qrX = W - MARGIN - qrSize
    const gap = 6
    const barcodeW = qrX - MARGIN - gap
    const barcodeH = 38

    // Serial barcode on the left + serial digits underneath.
    doc.addImage(barcodeImg, 'PNG', MARGIN, barcodeY, barcodeW, barcodeH)
    doc.setFont('courier', 'normal')
    doc.setFontSize(8)
    doc.text(item.serialNumber, MARGIN + barcodeW / 2, barcodeY + barcodeH + 8, { align: 'center' })

    // TRG QR on the right: tiny caption, QR, then the TRG digits underneath.
    const qrUrl = await QRCode.toDataURL(trg, { margin: 0, width: 240 })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5)
    doc.text('TRG', qrX + qrSize / 2, barcodeY, { align: 'center' })
    doc.addImage(qrUrl, 'PNG', qrX, barcodeY + 2, qrSize, qrSize)
    doc.setFont('courier', 'normal')
    let tSize = 6
    doc.setFontSize(tSize)
    const trgColW = qrSize + 10
    while (tSize > 3 && doc.getTextWidth(trg) > trgColW) { tSize -= 0.25; doc.setFontSize(tSize) }
    doc.text(trg, qrX + qrSize / 2, barcodeY + 2 + qrSize + 7, { align: 'center' })

    // Timestamp bottom-left so it clears the TRG digits on the right.
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.text(timestamp, MARGIN, H - 4)
  } else {
    const barcodeW = W - MARGIN * 2
    const barcodeH = 42
    doc.addImage(barcodeImg, 'PNG', MARGIN, barcodeY, barcodeW, barcodeH)
    doc.setFont('courier', 'normal')
    doc.setFontSize(8)
    doc.text(item.serialNumber, W / 2, barcodeY + barcodeH + 8, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.text(timestamp, W - MARGIN, H - 4, { align: 'right' })
  }
}

/**
 * Build a print-ready PDF of DYMO 30334 serial labels — one label per page —
 * and print it in one click. Goes straight to the configured default printer
 * via QZ Tray when available, otherwise falls back to the browser print dialog.
 * Client-only. Returns 'printer' (silent), 'dialog' (browser fallback), or 'none'.
 */
export async function printSerialLabels(items: SerialLabelItem[]): Promise<'printer' | 'dialog' | 'none'> {
  if (items.length === 0) return 'none'

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [H, W] })
  for (let idx = 0; idx < items.length; idx++) {
    if (idx > 0) doc.addPage([H, W], 'landscape')
    await drawSerialLabel(doc, items[idx])
  }

  const base64 = doc.output('datauristring').split(',')[1]
  return printPdfBase64(base64)
}
