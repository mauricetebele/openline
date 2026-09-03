import { jsPDF } from 'jspdf'
import JsBarcode from 'jsbarcode'
import { printPdfBase64 } from '@/lib/print-pdf'

export interface SerialLabelItem {
  serialNumber: string
  sku: string | null
  grade?: string | null
}

/**
 * Build a print-ready PDF of DYMO 30334 (2.25" × 1.25") serial labels — one
 * label per page — and print it in one click. Mirrors the single-label layout
 * used in SNLookupModal (SKU, grade, CODE128 barcode, serial, timestamp).
 * Goes straight to the configured default printer via QZ Tray when available,
 * otherwise falls back to the browser print dialog. Client-only.
 * Returns 'printer' (silent) or 'dialog' (browser fallback).
 */
export async function printSerialLabels(items: SerialLabelItem[]): Promise<'printer' | 'dialog' | 'none'> {
  if (items.length === 0) return 'none'

  const W = 2.25 * 72 // points
  const H = 1.25 * 72 // points
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [H, W] })

  const margin = 4
  const maxTextW = W - margin * 2
  const timestamp = new Date().toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', year: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })

  items.forEach((item, idx) => {
    if (idx > 0) doc.addPage([H, W], 'landscape')

    // SKU line (bold) — shrink font to fit
    const sku = item.sku ?? ''
    doc.setFont('helvetica', 'bold')
    let skuSize = 10
    doc.setFontSize(skuSize)
    while (skuSize > 5 && doc.getTextWidth(sku) > maxTextW) {
      skuSize -= 0.5
      doc.setFontSize(skuSize)
    }
    if (sku) doc.text(sku, margin, 12)

    // Grade line (bold, only if exists)
    let yAfterGrade = 12
    if (item.grade) {
      yAfterGrade = 22
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text(item.grade, margin, yAfterGrade)
    }

    // Barcode — render at 4x resolution for crisp PDF output
    const scale = 4
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, item.serialNumber, {
      format: 'CODE128',
      width: 2 * scale,
      height: 40 * scale,
      displayValue: false,
      margin: 0,
    })
    const barcodeY = yAfterGrade + 6
    const barcodeImg = canvas.toDataURL('image/png')
    const barcodeW = W - margin * 2
    const barcodeH = 42
    doc.addImage(barcodeImg, 'PNG', margin, barcodeY, barcodeW, barcodeH)

    // Serial number text below barcode (vector text)
    doc.setFont('courier', 'normal')
    doc.setFontSize(8)
    doc.text(item.serialNumber, W / 2, barcodeY + barcodeH + 8, { align: 'center' })

    // Timestamp (small, right-aligned at bottom)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.text(timestamp, W - margin, H - 4, { align: 'right' })
  })

  const base64 = doc.output('datauristring').split(',')[1]
  return printPdfBase64(base64)
}
