/**
 * Description Guessing engine (read-only, deterministic — no DB writes, no LLM).
 *
 * Product SKUs follow a fixed, hyphen-delimited structure, e.g.
 *   IPHONE-13PROMAX-128-GREEN-UNLK-RW  → "Apple iPhone 13 Pro Max 128GB [Green] Unlocked"
 *   IMAC27-E19I936-512-8-SILVER-B      → "Apple iMac 27\" Early 2019 i9 3.6GHz 512GB / 8GB [Silver]"
 *
 * Each SKU token maps to a consistent description fragment. We LEARN that
 * mapping from the existing catalog by diffing pairs of products whose SKUs
 * share the same structure and differ in exactly one position — the words that
 * differ between their descriptions are the fragment for that one token.
 *
 * Learning happens at two granularities:
 *   • fine  — per (family + model): captures model-specific naming such as
 *             GREEN→"[Mystic Green]" for a Note 20 or BLACK→"[Black Titanium]"
 *             for a 16 Pro Max, without contamination from other models.
 *   • coarse — per family: a fallback for universal tokens (128→"128GB") when a
 *             model has only ever shipped in one variant.
 *
 * To guess a new SKU we pick the closest existing product in the same family as
 * a template, then substitute the fragments for the tokens that differ.
 * Separators (family prefix, the " / " between storage and RAM) are preserved
 * from the template. A guess is only "high" confidence when the template shares
 * the exact model — i.e. we're filling in a new colour/storage/grade of a model
 * we already know.
 */

export type CorpusProduct = { sku: string; description: string }

export type Confidence = 'high' | 'low' | 'none'

export type GuessResult = {
  /** Input SKU, normalised (trimmed + upper-cased). */
  sku: string
  /** Best-effort description. Empty string when nothing could be guessed. */
  description: string
  confidence: Confidence
}

export type GuessResponse = {
  results: GuessResult[]
  /** Input SKUs that already exist in the catalog and were skipped. */
  skippedExisting: string[]
  /** Blank / duplicate lines that were ignored. */
  ignored: number
}

/** dict[position][token] -> most common fragment (array of words). */
type PosDict = Map<number, Map<string, string[]>>
type LearnedProduct = { tokens: string[]; words: string[]; description: string }

/** Split a SKU into upper-cased tokens. */
function tokenize(sku: string): string[] {
  return sku.trim().toUpperCase().split('-')
}

/** Family + segment count — used to group templates and for coarse learning. */
function familyKey(tokens: string[]): string {
  return `${tokens[0]}#${tokens.length}`
}

/** Family + model + segment count — used for fine, model-specific learning. */
function modelKey(tokens: string[]): string {
  return `${tokens[0]}|${tokens[1]}#${tokens.length}`
}

/** Index of the first contiguous occurrence of `frag` in `words`, at or after `from`. */
function indexOfSub(words: string[], frag: string[], from: number): number {
  if (frag.length === 0) return from
  outer: for (let i = from; i <= words.length - frag.length; i++) {
    for (let k = 0; k < frag.length; k++) {
      if (words[i + k] !== frag[k]) continue outer
    }
    return i
  }
  return -1
}

/**
 * Given two descriptions whose SKUs differ in exactly one position, return the
 * differing middle of each (the fragment that position contributes) by
 * stripping the common prefix and suffix.
 */
function diffMiddles(a: string[], b: string[]): [string[], string[]] {
  let i = 0
  const max = Math.min(a.length, b.length)
  while (i < max && a[i] === b[i]) i++
  let j = 0
  while (j < max - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++
  return [a.slice(i, a.length - j), b.slice(i, b.length - j)]
}

/** Title-case a raw SKU token for use as a last-resort fragment. */
function readableToken(tok: string): string {
  return tok
    .split(/[^A-Z0-9]+/i)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** Learn a token→fragment dictionary for each group via minimal pairs. */
function learnDicts(groups: Map<string, LearnedProduct[]>): Map<string, PosDict> {
  const out = new Map<string, PosDict>()

  for (const [key, group] of Array.from(groups)) {
    if (group.length < 2) continue
    const segCount = group[0].tokens.length
    const votes = new Map<number, Map<string, Map<string, number>>>() // pos -> token -> fragStr -> count

    const recordVote = (pos: number, token: string, frag: string[]) => {
      const fragStr = frag.join(' ')
      let byToken = votes.get(pos)
      if (!byToken) { byToken = new Map(); votes.set(pos, byToken) }
      let byFrag = byToken.get(token)
      if (!byFrag) { byFrag = new Map(); byToken.set(token, byFrag) }
      byFrag.set(fragStr, (byFrag.get(fragStr) ?? 0) + 1)
    }

    for (let p = 1; p < segCount; p++) {
      // Bucket by "all other tokens" so within a bucket only position p varies.
      const buckets = new Map<string, LearnedProduct[]>()
      for (const lp of group) {
        const maskKey = lp.tokens.map((t, i) => (i === p ? '*' : t)).join('-')
        const arr = buckets.get(maskKey)
        if (arr) arr.push(lp)
        else buckets.set(maskKey, [lp])
      }
      for (const bucket of Array.from(buckets.values())) {
        if (bucket.length < 2) continue
        for (let a = 0; a < bucket.length; a++) {
          for (let b = a + 1; b < bucket.length; b++) {
            const A = bucket[a], B = bucket[b]
            if (A.tokens[p] === B.tokens[p]) continue
            const [fa, fb] = diffMiddles(A.words, B.words)
            recordVote(p, A.tokens[p], fa)
            recordVote(p, B.tokens[p], fb)
          }
        }
      }
    }

    const posDict: PosDict = new Map()
    for (const [pos, byToken] of Array.from(votes)) {
      const resolved = new Map<string, string[]>()
      for (const [token, byFrag] of Array.from(byToken)) {
        let best = '', bestN = -1
        for (const [fragStr, n] of Array.from(byFrag)) {
          if (n > bestN) { best = fragStr; bestN = n }
        }
        resolved.set(token, best.length ? best.split(' ') : [])
      }
      posDict.set(pos, resolved)
    }
    out.set(key, posDict)
  }

  return out
}

export type GuessModel = {
  fine: Map<string, PosDict>   // modelKey -> dict
  coarse: Map<string, PosDict> // familyKey -> dict
  byFamily: Map<string, LearnedProduct[]>
  existing: Set<string>
}

/** Build the guessing model from the existing catalog. */
export function buildModel(corpus: CorpusProduct[]): GuessModel {
  const existing = new Set<string>()
  const byFamily = new Map<string, LearnedProduct[]>()
  const byModel = new Map<string, LearnedProduct[]>()

  for (const p of corpus) {
    const tokens = tokenize(p.sku)
    if (tokens.length < 2) continue
    existing.add(tokens.join('-'))
    const lp: LearnedProduct = {
      tokens,
      words: p.description.trim().split(/\s+/).filter(Boolean),
      description: p.description.trim(),
    }
    const fk = familyKey(tokens)
    ;(byFamily.get(fk) ?? byFamily.set(fk, []).get(fk)!).push(lp)
    const mk = modelKey(tokens)
    ;(byModel.get(mk) ?? byModel.set(mk, []).get(mk)!).push(lp)
  }

  return {
    fine: learnDicts(byModel),
    coarse: learnDicts(byFamily),
    existing,
    byFamily,
  }
}

/** Look up a token's fragment, preferring the model-specific (fine) dictionary. */
function lookupFrag(
  model: GuessModel,
  tokens: string[],
  pos: number,
  token: string,
): { frag: string[]; tier: 'fine' | 'coarse' } | undefined {
  const fine = model.fine.get(modelKey(tokens))?.get(pos)?.get(token)
  if (fine !== undefined) return { frag: fine, tier: 'fine' }
  const coarse = model.coarse.get(familyKey(tokens))?.get(pos)?.get(token)
  if (coarse !== undefined) return { frag: coarse, tier: 'coarse' }
  return undefined
}

/** Reconstruct a description for `tokens` using `template`. */
function reconstruct(
  tokens: string[],
  template: LearnedProduct,
  model: GuessModel,
): { description: string; unknown: number; usedCoarse: boolean } {
  const words = template.words
  const out: string[] = []
  let cursor = 0
  let unknown = 0
  let usedCoarse = false

  for (let p = 1; p < tokens.length; p++) {
    const tmplTok = template.tokens[p]
    // Locate this position's fragment in the template, using the template's own
    // (fine) dictionary so model-specific naming is matched exactly.
    const tmplLookup = lookupFrag(model, template.tokens, p, tmplTok)
    if (tmplLookup === undefined) continue // position not learned — leave words as separator
    const tmplFrag = tmplLookup.frag
    const idx = indexOfSub(words, tmplFrag, cursor)
    if (idx === -1) continue // not locatable in this template — skip substitution
    for (let k = cursor; k < idx; k++) out.push(words[k]) // separators
    if (tokens[p] === tmplTok) {
      for (const w of tmplFrag) out.push(w) // unchanged
    } else {
      const sub = lookupFrag(model, tokens, p, tokens[p])
      if (sub === undefined) {
        unknown++
        const readable = readableToken(tokens[p])
        if (readable) out.push(readable)
      } else {
        if (sub.tier === 'coarse') usedCoarse = true
        for (const w of sub.frag) out.push(w)
      }
    }
    cursor = idx + tmplFrag.length
  }
  for (let k = cursor; k < words.length; k++) out.push(words[k])

  return { description: out.join(' ').replace(/\s+/g, ' ').trim(), unknown, usedCoarse }
}

/**
 * Sanity-check a reconstructed description so garbled substitutions (unbalanced
 * brackets, duplicated spans from complex model codes) get downgraded to LOW
 * rather than being presented as trustworthy.
 */
function isCleanReconstruction(description: string, templateWordCount: number): boolean {
  // Balanced brackets — catches "[Black] Titanium]" and "[Mystic [Green]".
  const open = (description.match(/\[/g) ?? []).length
  const close = (description.match(/\]/g) ?? []).length
  if (open !== close) return false
  const words = description.split(' ')
  // Word count should stay close to the template for a same-model substitution;
  // a big jump means fragments were mislocated and text leaked/duplicated.
  if (Math.abs(words.length - templateWordCount) > 4) return false
  // A duplicated adjacent 2-word span is an artifact of mislocated fragments.
  for (let i = 0; i + 3 < words.length; i++) {
    if (words[i] === words[i + 2] && words[i + 1] === words[i + 3]) return false
  }
  return true
}

/** Guess a single normalised SKU. */
function guessOne(sku: string, model: GuessModel): GuessResult {
  const tokens = tokenize(sku)
  const normalised = tokens.join('-')
  const candidates = model.byFamily.get(familyKey(tokens))
  if (!candidates || candidates.length === 0) {
    return { sku: normalised, description: '', confidence: 'none' }
  }

  // Pick the template with the most matching token positions (closest twin),
  // preferring one that shares the exact model (position 1).
  let best: LearnedProduct | null = null
  let bestScore = -1
  for (const c of candidates) {
    let matches = 0
    for (let p = 1; p < tokens.length; p++) {
      if (c.tokens[p] === tokens[p]) matches++
    }
    const score = matches + (c.tokens[1] === tokens[1] ? 100 : 0) // strongly prefer same model
    if (score > bestScore) { bestScore = score; best = c }
  }
  if (!best) return { sku: normalised, description: '', confidence: 'none' }

  const { description, unknown } = reconstruct(tokens, best, model)
  if (!description) return { sku: normalised, description: '', confidence: 'none' }

  // High confidence only when we filled in a new variant of a model we already
  // know (template shares the exact model, every substituted token resolved,
  // and the reconstruction passes sanity checks). Anything else is flagged for
  // manual review — the guess is still shown, just not trusted.
  const sameModel = best.tokens[1] === tokens[1]
  const clean = isCleanReconstruction(description, best.words.length)
  const confidence: Confidence = unknown === 0 && sameModel && clean ? 'high' : 'low'
  return { sku: normalised, description, confidence }
}

/**
 * Guess descriptions for a list of raw SKU lines.
 * - Blank and duplicate lines are ignored.
 * - SKUs that already exist in the catalog are skipped (not in `results`).
 */
export function guessDescriptions(rawInput: string[], corpus: CorpusProduct[]): GuessResponse {
  const model = buildModel(corpus)
  const results: GuessResult[] = []
  const skippedExisting: string[] = []
  const seen = new Set<string>()
  let ignored = 0

  for (const raw of rawInput) {
    const trimmed = raw.trim()
    if (!trimmed) { ignored++; continue }
    const normalised = tokenize(trimmed).join('-')
    if (seen.has(normalised)) { ignored++; continue }
    seen.add(normalised)
    if (model.existing.has(normalised)) { skippedExisting.push(normalised); continue }
    results.push(guessOne(normalised, model))
  }

  return { results, skippedExisting, ignored }
}
