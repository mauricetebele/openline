import { NextRequest, NextResponse } from 'next/server'

/** Match SKU from serial section to SKU in name section (handles line-break splits) */
function findTitle(skuTitleMap: Map<string, string>, sku: string): string {
  // Direct match
  if (skuTitleMap.has(sku)) return skuTitleMap.get(sku)!
  // The name section may have the SKU split across lines (concatenated without separator)
  const normalized = sku.replace(/\s/g, '')
  const entries = Array.from(skuTitleMap.entries())
  for (const [key, title] of entries) {
    if (key.replace(/\s/g, '') === normalized) return title
  }
  // Partial match — name-section SKU may be a substring
  for (const [key, title] of entries) {
    if (normalized.includes(key.replace(/\s/g, '')) || key.replace(/\s/g, '').includes(normalized)) return title
  }
  return ''
}

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

    const orderMap = new Map<string, {
      orderId: string
      orderDate: string
      customerName: string
      address: string
      items: { sku: string; serial: string; title: string }[]
      tracking: string[]
      rawText: string
    }>()

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

      // Extract product titles from the SKU/NAME table section
      const skuTitleMap = new Map<string, string>()
      const nameSection = chunk.match(/SKUUPC\/EAN\s*NAME\s*QTY\s*PRICE\s*AMOUNT\s*\n([\s\S]*?)(?:Sub\s*Total|SERIAL\s*#)/i)
      if (nameSection) {
        const block = nameSection[1].trim()
        const blockLines = block.split(/\n/).map((l: string) => l.trim()).filter(Boolean)
        // Walk lines: SKU lines contain dashes and letters, title lines are descriptive text,
        // price lines contain $ amounts. Collect title fragments between SKU and price.
        let currentSku = ''
        let titleParts: string[] = []
        for (const line of blockLines) {
          // Price/amount line ends this item
          if (/\$[\d,.]+/.test(line)) {
            // strip leading qty and trailing price from the line if title is embedded
            const titleInLine = line.replace(/^\d+\s*/, '').replace(/\$[\d,.]+\s*/g, '').trim()
            if (titleInLine) titleParts.push(titleInLine)
            if (currentSku && titleParts.length > 0) {
              skuTitleMap.set(currentSku, titleParts.join(' ').trim())
            }
            currentSku = ''
            titleParts = []
          } else if (/[A-Z]/.test(line) && line.includes('-') && line.length > 5 && !/^\d{10,}$/.test(line.replace(/\s/g, ''))) {
            // New SKU line (may be split across lines, merge with previous if no title yet)
            if (currentSku && titleParts.length === 0) {
              currentSku += line
            } else {
              // Save previous if exists
              if (currentSku && titleParts.length > 0) {
                skuTitleMap.set(currentSku, titleParts.join(' ').trim())
              }
              currentSku = line
              titleParts = []
            }
          } else if (/^\d{10,}$/.test(line.replace(/\s/g, ''))) {
            // UPC/EAN line — skip
          } else if (line.length > 3) {
            // Title fragment
            titleParts.push(line)
          }
        }
        if (currentSku && titleParts.length > 0) {
          skuTitleMap.set(currentSku, titleParts.join(' ').trim())
        }
      }

      // Find SERIAL # DETAILS BY SKU section (extract items before tracking so we can filter serials)
      const items: { sku: string; serial: string; title: string }[] = []
      const serialSection = chunk.match(/SERIAL\s*#?\s*DETAILS\s*BY\s*SKU[:\s]*([\s\S]*?)(?:POWERED\s*BY|$)/i)
      if (serialSection) {
        const section = serialSection[1].trim()
        const lines = section.split(/\n/).map((l: string) => l.trim()).filter(Boolean)
        let currentSku = ''
        for (const line of lines) {
          if (/[A-Z]/.test(line) && line.includes('-') && line.length > 5 && !/^\d+$/.test(line)) {
            currentSku = line
          } else if (/^[A-Z0-9]{6,}$/.test(line.replace(/\s/g, '')) && currentSku) {
            // Look up title by finding a SKU key that matches (SKU in name section may have line breaks)
            const title = findTitle(skuTitleMap, currentSku)
            items.push({ sku: currentSku, serial: line.replace(/\s/g, ''), title })
          }
        }
        if (currentSku && items.length === 0) {
          const title = findTitle(skuTitleMap, currentSku)
          items.push({ sku: currentSku, serial: '', title })
        }
      }

      // Extract tracking numbers — only known carrier patterns (UPS 1Z, USPS 92/93/94/95)
      const tracking: string[] = []
      const serialSet = new Set(items.map(it => it.serial).filter(Boolean))
      const trackingMatches = chunk.match(/\b(1Z[A-Z0-9]{16}|(?:92|94|93|95)\d{18,22})\b/g)
      if (trackingMatches) {
        for (const t of trackingMatches) {
          if (!serialSet.has(t) && !tracking.includes(t)) tracking.push(t)
        }
      }

      // Merge into existing order or create new entry
      const existing = orderMap.get(orderId)
      if (existing) {
        existing.items.push(...items)
        for (const t of tracking) {
          if (!existing.tracking.includes(t)) existing.tracking.push(t)
        }
        existing.rawText += '\n---\n' + chunk
      } else {
        orderMap.set(orderId, {
          orderId,
          orderDate,
          customerName,
          address,
          items,
          tracking,
          rawText: chunk,
        })
      }
    }

    const records = Array.from(orderMap.values())

    return NextResponse.json({ records })
  } catch (err) {
    console.error('[legacy-invoices/parse]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Parse failed' }, { status: 500 })
  }
}
