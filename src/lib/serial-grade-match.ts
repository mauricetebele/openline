/**
 * Pure, DB-free helpers for grade-aware serial→order matching used by the
 * "scan serial to ship" flow (see src/app/api/orders/match-by-sku/route.ts).
 *
 * Grade resolution mirrors the serialize/validate routes: an order item's
 * expected grade is its own gradeId, falling back to the grade of its
 * marketplace-SKU mapping, else null (ungraded). A scanned serial resolves
 * only to an order whose resolved grade equals the serial's grade — both null
 * (ungraded ↔ ungraded) or the same gradeId (e.g. GRADE C ↔ GRADE C).
 */

export interface MatchOrderItem {
  gradeId: string | null
  sellerSku: string | null
  quantityOrdered: number
}

export interface MatchOrder<TItem extends MatchOrderItem = MatchOrderItem> {
  items: TItem[]
}

/**
 * Resolve an order item's expected grade.
 * @param skuToGradeId map of the product's marketplace sellerSku -> gradeId (null = ungraded mapping)
 */
export function resolveItemGradeId(
  item: { gradeId: string | null; sellerSku: string | null },
  skuToGradeId: Map<string, string | null>,
): string | null {
  if (item.gradeId) return item.gradeId
  if (item.sellerSku && skuToGradeId.has(item.sellerSku)) return skuToGradeId.get(item.sellerSku) ?? null
  return null
}

/**
 * From candidate orders (expected to be pre-sorted oldest-first), pick the first
 * single-qty order whose resolved grade equals the scanned serial's grade.
 *
 * @param candidates    AWAITING_VERIFICATION orders that have an item in skusToMatch
 * @param skusToMatch   every sellerSku that could belong to the product, across all grades
 * @param skuToGradeId  sellerSku -> gradeId for the product's marketplace mappings
 * @param scannedGradeId the grade of the scanned serial (null = ungraded)
 */
export function pickGradeMatchedOrder<TOrder extends MatchOrder>(
  candidates: TOrder[],
  skusToMatch: string[],
  skuToGradeId: Map<string, string | null>,
  scannedGradeId: string | null,
): TOrder | undefined {
  return candidates.find(order => {
    const totalQty = order.items.reduce((sum, item) => sum + item.quantityOrdered, 0)
    if (totalQty !== 1) return false
    // Identify the line item that corresponds to this product, then compare grades.
    const item = order.items.find(i => i.sellerSku != null && skusToMatch.includes(i.sellerSku))
    if (!item) return false
    return resolveItemGradeId(item, skuToGradeId) === scannedGradeId
  })
}
