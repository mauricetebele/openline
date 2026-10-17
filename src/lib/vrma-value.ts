/**
 * Value of a vendor-RMA line = what the units cost WHEN THEY WERE RETURNED.
 *
 *  - Prefer the per-unit snapshot (VendorRMAItem.unitCost, captured at RMA
 *    creation) × quantity. This is immune to a cheaper re-receipt of the same
 *    serial after the return (which repoints the serial to a cheaper receipt).
 *  - But a snapshot stored as a rounded 2-dp average makes average × qty off by
 *    a cent (e.g. 726.67 × 3 = 2180.01 vs a true $2180). So when the sum of the
 *    serials' live costs AGREES with the snapshot total within rounding, trust
 *    that whole-number sum instead. A material disagreement means the serials
 *    were re-received at a different cost → keep the snapshot total.
 *
 * Returns a number rounded to cents, or null when nothing is known.
 */
export function computeVrmaItemValue(
  snapshotUnitCost: number | null,
  quantity: number,
  liveSerialCosts: number[],
  serialCount: number,
): number | null {
  const snapTotal = snapshotUnitCost != null ? snapshotUnitCost * quantity : null
  const allHaveLive = serialCount > 0 && liveSerialCosts.length === serialCount
  const liveSum = allHaveLive ? liveSerialCosts.reduce((a, b) => a + b, 0) : null
  const round2 = (n: number) => Math.round(n * 100) / 100

  if (liveSum != null && snapTotal != null && Math.abs(liveSum - snapTotal) <= quantity * 0.01 + 0.005) {
    return round2(liveSum)
  }
  if (snapTotal != null) return round2(snapTotal)
  if (liveSum != null) return round2(liveSum)
  return null
}
