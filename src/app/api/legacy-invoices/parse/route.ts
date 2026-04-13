import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData() as unknown as globalThis.FormData
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())

    // pdf-parse needs this workaround for Next.js bundling
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse')
    const parsed = await pdfParse(buffer)

    const fullText: string = parsed.text ?? ''

    // Split into per-invoice chunks by looking for the INVOICE header pattern
    const invoiceChunks = fullText.split(/(?=DATE\s+INVOICE\s*#)/)
      .map((c: string) => c.trim())
      .filter((c: string) => c.length > 20)

    // If splitting didn't work, treat the whole text as one invoice
    const chunks = invoiceChunks.length > 0 ? invoiceChunks : [fullText]

    const records: { orderId: string; sku: string; serial: string; customerName: string; address: string }[] = []

    for (const chunk of chunks) {
      // Extract order ID (Amazon pattern: xxx-xxxxxxx-xxxxxxx)
      const orderMatch = chunk.match(/(\d{3}-\d{7}-\d{7})/)
      const orderId = orderMatch?.[1] ?? ''
      if (!orderId) continue

      // Extract customer name and address
      // Invoice text typically has "SHIP TO" or "BILL TO" followed by name and address lines
      // Or the customer name/address appears before the DATE/INVOICE header
      let customerName = ''
      let address = ''

      // Try SHIP TO pattern
      const shipToMatch = chunk.match(/SHIP\s*TO[:\s]*\n([\s\S]*?)(?:\n\s*\n|DATE\s+INVOICE|BILL\s*TO|ITEM)/i)
      if (shipToMatch) {
        const addressLines = shipToMatch[1].split('\n').map((l: string) => l.trim()).filter(Boolean)
        if (addressLines.length > 0) customerName = addressLines[0]
        if (addressLines.length > 1) address = addressLines.slice(1).join(', ')
      }

      // Try BILL TO pattern as fallback
      if (!customerName) {
        const billToMatch = chunk.match(/BILL\s*TO[:\s]*\n([\s\S]*?)(?:\n\s*\n|DATE\s+INVOICE|SHIP\s*TO|ITEM)/i)
        if (billToMatch) {
          const addressLines = billToMatch[1].split('\n').map((l: string) => l.trim()).filter(Boolean)
          if (addressLines.length > 0) customerName = addressLines[0]
          if (addressLines.length > 1) address = addressLines.slice(1).join(', ')
        }
      }

      // Fallback: look for address-like block before DATE line (name on first non-empty line)
      if (!customerName) {
        const lines = chunk.split('\n').map((l: string) => l.trim()).filter(Boolean)
        // First line that looks like a name (has letters, no digits-only, not a header keyword)
        for (const line of lines) {
          if (/^(DATE|INVOICE|ITEM|QTY|SERIAL|SKU|TOTAL|SUBTOTAL|TAX|POWERED)/i.test(line)) break
          if (/[a-zA-Z]/.test(line) && !/^\d+$/.test(line) && line.length > 2 && line.length < 80) {
            if (!customerName) {
              customerName = line
            } else if (!address) {
              address = line
            }
          }
        }
      }

      // Find SERIAL # DETAILS BY SKU section
      const serialSection = chunk.match(/SERIAL\s*#?\s*DETAILS\s*BY\s*SKU[:\s]*([\s\S]*?)(?:POWERED\s*BY|$)/i)
      if (serialSection) {
        const section = serialSection[1].trim()
        const lines = section.split(/\n/).map((l: string) => l.trim()).filter(Boolean)
        let currentSku = ''
        for (const line of lines) {
          if (/[A-Z]/.test(line) && line.includes('-') && line.length > 5 && !/^\d+$/.test(line)) {
            currentSku = line
          } else if (/^\d{10,}$/.test(line.replace(/\s/g, ''))) {
            records.push({ orderId, sku: currentSku, serial: line.replace(/\s/g, ''), customerName, address })
          }
        }
        if (currentSku && !records.some(r => r.orderId === orderId)) {
          records.push({ orderId, sku: currentSku, serial: '', customerName, address })
        }
      } else {
        records.push({ orderId, sku: '', serial: '', customerName, address })
      }
    }

    return NextResponse.json({ records })
  } catch (err) {
    console.error('[legacy-invoices/parse]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Parse failed' }, { status: 500 })
  }
}
