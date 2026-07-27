/**
 * Unit tests for grade-aware serial→order matching (src/lib/serial-grade-match.ts).
 *
 * Reproduces the reported glitch: with >1 AWAITING_VERIFICATION order for the same
 * product across different grades (Ungraded + GRADE C), a scanned serial must resolve
 * to the order matching ITS grade, not merely the oldest single-qty order.
 * No DB or network — pure logic against in-memory fixtures.
 */
import { resolveItemGradeId, pickGradeMatchedOrder, type MatchOrder } from '../lib/serial-grade-match'

// --- Fixtures ---------------------------------------------------------------
const BASE_SKU = 'WIDGET-123' // ungraded listing uses the bare SKU
const GRADE_C_SKU = 'WIDGET-123-C' // marketplace SKU mapped to GRADE C
const GRADE_C_ID = 'grade_c_id'

// sellerSku -> gradeId for the product's marketplace mappings (base SKU is NOT mapped)
const skuToGradeId = new Map<string, string | null>([[GRADE_C_SKU, GRADE_C_ID]])
const skusToMatch = [BASE_SKU, GRADE_C_SKU]

// Ungraded order is OLDER than the GRADE C order — so "oldest single-qty" (the old buggy
// behavior) would always return the ungraded order regardless of what was scanned.
const ungradedOrder: MatchOrder & { id: string } = {
  id: 'order_ungraded',
  items: [{ gradeId: null, sellerSku: BASE_SKU, quantityOrdered: 1 }],
}
const gradeCOrder: MatchOrder & { id: string } = {
  id: 'order_grade_c',
  items: [{ gradeId: null, sellerSku: GRADE_C_SKU, quantityOrdered: 1 }],
}
const candidatesOldestFirst = [ungradedOrder, gradeCOrder]

describe('resolveItemGradeId', () => {
  it('prefers the item\'s own gradeId', () => {
    expect(resolveItemGradeId({ gradeId: GRADE_C_ID, sellerSku: BASE_SKU }, skuToGradeId)).toBe(GRADE_C_ID)
  })

  it('falls back to the marketplace-SKU mapping grade', () => {
    expect(resolveItemGradeId({ gradeId: null, sellerSku: GRADE_C_SKU }, skuToGradeId)).toBe(GRADE_C_ID)
  })

  it('resolves to null (ungraded) for the bare SKU with no mapping', () => {
    expect(resolveItemGradeId({ gradeId: null, sellerSku: BASE_SKU }, skuToGradeId)).toBeNull()
  })
})

describe('pickGradeMatchedOrder — the reported glitch', () => {
  it('scanning a GRADE C serial resolves to the GRADE C order (not the older ungraded one)', () => {
    const match = pickGradeMatchedOrder(candidatesOldestFirst, skusToMatch, skuToGradeId, GRADE_C_ID)
    expect(match?.id).toBe('order_grade_c')
  })

  it('scanning an ungraded serial resolves to the ungraded order (not a graded one)', () => {
    const match = pickGradeMatchedOrder(candidatesOldestFirst, skusToMatch, skuToGradeId, null)
    expect(match?.id).toBe('order_ungraded')
  })

  it('order independence: still grade-correct when GRADE C order is listed first', () => {
    const reordered = [gradeCOrder, ungradedOrder]
    expect(pickGradeMatchedOrder(reordered, skusToMatch, skuToGradeId, null)?.id).toBe('order_ungraded')
    expect(pickGradeMatchedOrder(reordered, skusToMatch, skuToGradeId, GRADE_C_ID)?.id).toBe('order_grade_c')
  })
})

describe('pickGradeMatchedOrder — grade via item.gradeId directly', () => {
  it('matches an order whose item carries gradeId directly (no mapping needed)', () => {
    const directGraded: MatchOrder & { id: string } = {
      id: 'order_direct_c',
      items: [{ gradeId: GRADE_C_ID, sellerSku: BASE_SKU, quantityOrdered: 1 }],
    }
    // base SKU + direct gradeId → resolves to GRADE C, so an ungraded scan must NOT match it
    expect(pickGradeMatchedOrder([directGraded], skusToMatch, skuToGradeId, null)).toBeUndefined()
    expect(pickGradeMatchedOrder([directGraded], skusToMatch, skuToGradeId, GRADE_C_ID)?.id).toBe('order_direct_c')
  })
})

describe('pickGradeMatchedOrder — no false positives', () => {
  it('returns undefined when only a wrong-grade order exists', () => {
    expect(pickGradeMatchedOrder([gradeCOrder], skusToMatch, skuToGradeId, null)).toBeUndefined()
    expect(pickGradeMatchedOrder([ungradedOrder], skusToMatch, skuToGradeId, GRADE_C_ID)).toBeUndefined()
  })

  it('skips multi-unit orders (total quantityOrdered !== 1)', () => {
    const multiQty: MatchOrder & { id: string } = {
      id: 'order_multi',
      items: [{ gradeId: null, sellerSku: BASE_SKU, quantityOrdered: 2 }],
    }
    expect(pickGradeMatchedOrder([multiQty], skusToMatch, skuToGradeId, null)).toBeUndefined()
  })

  it('returns undefined when no candidate has a matching sellerSku', () => {
    const otherProduct: MatchOrder & { id: string } = {
      id: 'order_other',
      items: [{ gradeId: null, sellerSku: 'SOMETHING-ELSE', quantityOrdered: 1 }],
    }
    expect(pickGradeMatchedOrder([otherProduct], skusToMatch, skuToGradeId, null)).toBeUndefined()
  })
})
