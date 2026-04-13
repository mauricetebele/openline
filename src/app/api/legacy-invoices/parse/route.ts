import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData() as unknown as globalThis.FormData
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())

    // Import directly from lib to avoid index.js test-file loading issue on Vercel
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse/lib/pdf-parse')
    const parsed = await pdfParse(buffer)

    const fullText: string = parsed.text ?? ''

    // Split into per-invoice chunks — handle both "DATE INVOICE #" and "DATEINVOICE #"
    const invoiceChunks = fullText.split(/(?=DATE\s*INVOICE\s*#)/)
      .map((c: string) => c.trim())
      .filter((c: string) => c.length > 20)

    const chunks = invoiceChunks.length > 0 ? invoiceChunks : [fullText]

    const records: { orderId: string; orderDate: string; sku: string; serial: string; customerName: string; address: string }[] = []

    for (const chunk of chunks) {
      // Extract order ID (Amazon pattern: xxx-xxxxxxx-xxxxxxx)
      const orderMatch = chunk.match(/(\d{3}-\d{7}-\d{7})/)
      const orderId = orderMatch?.[1] ?? ''
      if (!orderId) continue

      // Extract order date — appears as MM-DD-YY right before the order ID
      let orderDate = ''
      const dateMatch = chunk.match(/(\d{2}-\d{2}-\d{2,4})\s*\d{3}-\d{7}-\d{7}/)
      if (dateMatch) {
        const parts = dateMatch[1].split('-')
        if (parts.length === 3) {
          const yy = parts[2].length === 2 ? '20' + parts[2] : parts[2]
          orderDate = `${yy}-${parts[0]}-${parts[1]}`
        }
      }

      // Extract customer name and address from SHIPPING ADDRESS section
      let customerName = ''
      let address = ''

      const shipMatch = chunk.match(/SHIPPING\s*ADDRESS[:\s]*\n([\s\S]*?)(?:\n\d{10,}|\nTERMS|\nSKU)/i)
      if (shipMatch) {
        const lines = shipMatch[1].split('\n').map((l: string) => l.trim()).filter(Boolean)
        // Filter out "US" country-only lines from the name
        const meaningful = lines.filter(l => l.length > 2)
        if (meaningful.length > 0) customerName = meaningful[0]
        if (meaningful.length > 1) address = meaningful.slice(1).filter(l => l !== 'US').join(', ')
      }

      // Fallback: try CONTACT BUYER section for name
      if (!customerName) {
        const contactMatch = chunk.match(/CONTACT\s*BUYER\s*\n([^\n@]+)/i)
        if (contactMatch) customerName = contactMatch[1].trim()
      }

      // Fallback: try SHIP TO pattern
      if (!customerName) {
        const shipToMatch = chunk.match(/SHIP\s*TO[:\s]*\n([\s\S]*?)(?:\n\s*\n|DATE|ITEM)/i)
        if (shipToMatch) {
          const lines = shipToMatch[1].split('\n').map((l: string) => l.trim()).filter(Boolean)
          if (lines.length > 0) customerName = lines[0]
          if (lines.length > 1) address = lines.slice(1).filter(l => l !== 'US').join(', ')
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
            records.push({ orderId, orderDate, sku: currentSku, serial: line.replace(/\s/g, ''), customerName, address })
          }
        }
        if (currentSku && !records.some(r => r.orderId === orderId)) {
          records.push({ orderId, orderDate, sku: currentSku, serial: '', customerName, address })
        }
      } else {
        records.push({ orderId, orderDate, sku: '', serial: '', customerName, address })
      }
    }

    return NextResponse.json({ records })
  } catch (err) {
    console.error('[legacy-invoices/parse]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Parse failed' }, { status: 500 })
  }
}
