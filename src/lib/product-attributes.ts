/**
 * Parse a product description/title (e.g. "MacBook Pro 16 M3 Max 36GB 1TB Space Black")
 * into structured attributes for Product Families filtering. Heuristic/regex based —
 * no external API. Returns null for anything it can't confidently detect.
 */
export interface ProductAttrs {
  storage: string | null
  ram: string | null
  cpu: string | null
  gpu: string | null
  color: string | null
  screen: string | null
}

const RAM_SIZES = new Set([2, 3, 4, 6, 8, 10, 12, 16, 18, 24, 32, 36, 48, 64, 96, 128])
const STORAGE_GB = [32, 64, 128, 256, 512, 1024, 2048]

// Longest first so "Space Gray" matches before "Gray".
const COLORS = [
  'Space Gray', 'Space Grey', 'Space Black', 'Natural Titanium', 'Blue Titanium', 'White Titanium',
  'Black Titanium', 'Desert Titanium', 'Rose Gold', 'Sierra Blue', 'Alpine Green', 'Deep Purple',
  'Pacific Blue', 'Sky Blue', 'Product Red', 'Jet Black', 'Midnight', 'Starlight', 'Graphite',
  'Titanium', 'Silver', 'Gold', 'Coral', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Red',
  'Teal', 'Cyan', 'Lavender', 'Mint', 'Bronze', 'Beige', 'Cream', 'Black', 'White', 'Gray', 'Grey', 'Rose',
]

function detectColor(s: string): string | null {
  for (const c of COLORS) {
    if (new RegExp(`\\b${c.replace(/ /g, '\\s+')}\\b`, 'i').test(s)) return c
  }
  return null
}

function detectCpu(s: string): string | null {
  const patterns = [
    /\bM[1-4]\s?(?:Pro|Max|Ultra)\b/i,             // Apple Silicon w/ tier
    /\bM[1-4]\b/i,                                  // Apple Silicon base
    /\b(?:Intel\s?)?Core\s?i[3579][-\s]?\d{3,5}[A-Z]*\b/i, // Intel Core iX
    /\bi[3579][-\s]?\d{4,5}[A-Z]*\b/i,
    /\bRyzen\s?\d\s?\d{3,4}[A-Z]*\b/i,              // AMD Ryzen
    /\bSnapdragon\s?[\w+]+\b/i,                     // Qualcomm
    /\bA1[0-9]\s?(?:Pro|Bionic)?\b/i,              // Apple A-series (phones)
    /\bTensor\s?G?\d?\b/i,                          // Google Tensor
    /\bExynos\s?\d+\b/i,                            // Samsung Exynos
  ]
  for (const p of patterns) { const m = s.match(p); if (m) return m[0].replace(/\s+/g, ' ').trim() }
  return null
}

function detectGpu(s: string): string | null {
  // Apple Silicon GPU core count, e.g. "10-core GPU" / "10 Core GPU".
  const core = s.match(/(\d{1,2})[\s-]*core\s*GPU/i)
  if (core) return `${core[1]}-core GPU`
  const m = s.match(/\b(?:RTX|GTX|RX)\s?\d{3,4}(?:\s?Ti)?\b|\bRadeon\s?[\w ]{0,10}\b|\bIris\s?Xe\b|\bUHD\s?Graphics\b/i)
  return m ? m[0].replace(/\s+/g, ' ').trim() : null
}

function detectScreen(s: string): string | null {
  const m = s.match(/\b(\d{1,2}(?:\.\d)?)\s?(?:inch|-in\b|"|”)/i)
  return m ? `${m[1]}"` : null
}

export function parseProductAttrs(input: string): ProductAttrs {
  const s = ` ${input} `
  const attrs: ProductAttrs = { storage: null, ram: null, cpu: null, gpu: null, color: null, screen: null }

  // Storage: any TB value is storage. Then classify GB values.
  const tb = s.match(/(\d+(?:\.\d+)?)\s?TB\b/i)
  const gbAll = [...s.matchAll(/(\d+)\s?GB\b/gi)].map(m => Number(m[1]))
  if (tb) attrs.storage = `${tb[1]}TB`

  // Explicitly-labeled RAM wins.
  const ramLabeled = s.match(/(\d+)\s?GB\s*(?:RAM|Memory|Unified)/i)
  if (ramLabeled) attrs.ram = `${ramLabeled[1]}GB`

  if (!attrs.storage && gbAll.length) {
    const cands = gbAll.filter(v => STORAGE_GB.includes(v))
    if (cands.length) attrs.storage = `${Math.max(...cands)}GB`
  }
  if (!attrs.ram && gbAll.length) {
    const storageNum = attrs.storage && attrs.storage.endsWith('GB') ? parseInt(attrs.storage) : null
    const cands = gbAll.filter(v => RAM_SIZES.has(v) && v !== storageNum)
    if (cands.length) attrs.ram = `${Math.min(...cands)}GB`
  }

  attrs.cpu = detectCpu(s)
  attrs.gpu = detectGpu(s)
  attrs.color = detectColor(s)
  attrs.screen = detectScreen(s)
  return attrs
}
