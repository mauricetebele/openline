import { PDFDocument } from 'pdf-lib'

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

/** Open a single label (PDF or image) in a new tab for printing. */
export function openLabel(base64: string, format: string) {
  const mime = format === 'pdf' ? 'application/pdf' : `image/${format}`
  const url = URL.createObjectURL(new Blob([b64ToBytes(base64) as BlobPart], { type: mime }))
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Merge labels into one 4×6 multi-page PDF and open it for printing. Labels are
 *  already 4×6 (UPS converted, FedEx STOCK_4X6), so pages are preserved as-is. */
export async function printAllLabels(labels: { labelData: string; labelFormat: string }[]): Promise<void> {
  if (labels.length === 0) return
  const out = await PDFDocument.create()
  const W = 4 * 72, H = 6 * 72
  for (const l of labels) {
    const bytes = b64ToBytes(l.labelData)
    if (l.labelFormat === 'pdf') {
      const src = await PDFDocument.load(bytes)
      const pages = await out.copyPages(src, src.getPageIndices())
      pages.forEach(p => out.addPage(p))
    } else {
      const page = out.addPage([W, H])
      try {
        const img = await out.embedPng(bytes)
        page.drawImage(img, { x: 0, y: 0, width: W, height: H })
      } catch { /* skip unrenderable image */ }
    }
  }
  const merged = await out.save()
  const url = URL.createObjectURL(new Blob([merged as BlobPart], { type: 'application/pdf' }))
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 120_000)
}
