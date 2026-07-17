/**
 * Holdout validation for the description guesser.
 * Run with: npx tsx scripts/test-description-guesser.ts
 */
import { prisma } from '@/lib/prisma'
import { guessDescriptions, type CorpusProduct } from '@/lib/description-guesser'

function seededPick<T>(arr: T[], n: number): T[] {
  // deterministic pseudo-sample (every k-th) so runs are comparable
  const step = Math.max(1, Math.floor(arr.length / n))
  const out: T[] = []
  for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i])
  return out
}

async function main() {
  const all = await prisma.product.findMany({ select: { sku: true, description: true } })
  const corpus: CorpusProduct[] = all
    .filter(p => p.description && p.description.trim().length > 0)
    .map(p => ({ sku: p.sku, description: p.description }))
  console.log(`Corpus: ${corpus.length} products`)

  const sixSeg = corpus.filter(p => p.sku.split('-').length === 6)
  const sample = seededPick(sixSeg, 80)

  let exact = 0
  const byConf: Record<string, { n: number; exact: number }> = {
    high: { n: 0, exact: 0 }, low: { n: 0, exact: 0 }, none: { n: 0, exact: 0 },
  }
  const highMismatches: string[] = []

  for (const target of sample) {
    const heldout = corpus.filter(p => p.sku !== target.sku)
    const { results } = guessDescriptions([target.sku], heldout)
    const r = results[0]
    const ok = r.description === target.description.trim()
    byConf[r.confidence].n++
    if (ok) { byConf[r.confidence].exact++; exact++ }
    else if (r.confidence === 'high' && highMismatches.length < 15) {
      highMismatches.push(
        `SKU:  ${target.sku}\n  want: ${target.description}\n  got:  ${r.description}`,
      )
    }
  }

  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : '—') + '%'
  console.log(`\nSample: ${sample.length}`)
  console.log(`Overall exact match: ${exact}/${sample.length} (${pct(exact, sample.length)})`)
  console.log(`HIGH precision: ${byConf.high.exact}/${byConf.high.n} (${pct(byConf.high.exact, byConf.high.n)})  <-- the trusted rows`)
  console.log(`LOW  precision: ${byConf.low.exact}/${byConf.low.n} (${pct(byConf.low.exact, byConf.low.n)})`)
  console.log(`NONE: ${byConf.none.n}`)
  console.log(`\nHIGH-confidence mismatches (first ${Math.min(15, highMismatches.length)}) — these should be ~0:`)
  for (const m of highMismatches) console.log('- ' + m)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
