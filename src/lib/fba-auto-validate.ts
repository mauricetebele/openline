/**
 * Auto-validation logic for FBA refunds.
 * Used by both the manual trigger API and the cron sync job.
 *
 * Multi-unit detection:
 *   1. If Order → OrderItem data exists (MFN orders), use original order line count + qty.
 *   2. Otherwise (FBA orders), use refund data as proxy: count distinct SKU lines per
 *      orderId and check max refundQty across those lines.
 */
import { prisma } from '@/lib/prisma'

export async function autoValidateFbaRefunds() {
  // 1. Fetch all UNVALIDATED refunds
  const refunds = await prisma.fbaRefund.findMany({
    where: { validationStatus: 'UNVALIDATED' },
    select: { id: true, orderId: true, sku: true, refundQty: true, refundDate: true },
  })

  if (refunds.length === 0) return { validated: 0, manualReview: 0, unchanged: 0 }

  const orderIds = Array.from(new Set(refunds.map(r => r.orderId)))

  // 2a. Batch lookup Order → OrderItem (works for MFN orders in the orders table)
  const orders = await prisma.order.findMany({
    where: { amazonOrderId: { in: orderIds } },
    select: {
      amazonOrderId: true,
      items: { select: { quantityOrdered: true } },
    },
  })

  const orderItemMap = new Map<string, { lineCount: number; maxQty: number }>()
  for (const o of orders) {
    orderItemMap.set(o.amazonOrderId, {
      lineCount: o.items.length,
      maxQty: o.items.reduce((max, i) => Math.max(max, i.quantityOrdered), 0),
    })
  }

  // 2b. For FBA orders without Order data, build multi-unit info from the refund lines themselves.
  //     Group refund lines by orderId → count distinct SKUs + max refundQty.
  const skuSets = new Map<string, Set<string>>()
  const maxQtyMap = new Map<string, number>()
  for (const r of refunds) {
    if (orderItemMap.has(r.orderId)) continue // already have real order data
    if (!skuSets.has(r.orderId)) skuSets.set(r.orderId, new Set())
    if (r.sku) skuSets.get(r.orderId)!.add(r.sku)
    maxQtyMap.set(r.orderId, Math.max(maxQtyMap.get(r.orderId) ?? 0, r.refundQty))
  }

  // Merge fallback into orderItemMap
  for (const [orderId, skus] of Array.from(skuSets.entries())) {
    orderItemMap.set(orderId, {
      lineCount: skus.size || 1,
      maxQty: maxQtyMap.get(orderId) ?? 1,
    })
  }

  // 3. Batch lookup FbaReturn (status contains "returned") and FbaReimbursement
  const returns = await prisma.fbaReturn.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true, status: true },
  })

  const returnedSet = new Set<string>()
  for (const ret of returns) {
    if (ret.status?.toLowerCase().includes('returned')) {
      returnedSet.add(ret.orderId)
    }
  }

  const reimbursements = await prisma.fbaReimbursement.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true },
  })

  const reimbursedSet = new Set(reimbursements.map(r => r.orderId).filter(Boolean) as string[])

  // 4. Apply rules and group by outcome
  const now = new Date()
  const toManualReview: string[] = []
  const withinWindow: string[] = []
  let unchanged = 0

  const reasonGroups = new Map<string, string[]>()

  for (const refund of refunds) {
    const orderInfo = orderItemMap.get(refund.orderId)

    // Multi-unit or multi-line → MANUAL_REVIEW
    if (orderInfo && (orderInfo.lineCount > 1 || orderInfo.maxQty > 1)) {
      toManualReview.push(refund.id)
      continue
    }

    // Single-unit order — check return + reimbursement
    const hasReturn = returnedSet.has(refund.orderId)
    const hasReimbursement = reimbursedSet.has(refund.orderId)

    let reason: string | null = null
    if (hasReturn && hasReimbursement) {
      reason = 'Auto: return received + reimbursement found'
    } else if (hasReturn) {
      reason = 'Auto: return received'
    } else if (hasReimbursement) {
      reason = 'Auto: reimbursement found'
    }

    if (reason) {
      const group = reasonGroups.get(reason) ?? []
      group.push(refund.id)
      reasonGroups.set(reason, group)
    } else {
      // No return or reimbursement — check if within 60-day window
      const ageMs = now.getTime() - refund.refundDate.getTime()
      if (ageMs < 60 * 86_400_000) {
        withinWindow.push(refund.id)
      } else {
        unchanged++
      }
    }
  }

  // 5. Batch updates
  const txOps = []

  for (const [reason, ids] of Array.from(reasonGroups.entries())) {
    txOps.push(
      prisma.fbaRefund.updateMany({
        where: { id: { in: ids } },
        data: {
          validationStatus: 'VALIDATED',
          validatedAt: now,
          validationReason: reason,
          validationSource: 'auto',
        },
      }),
    )
  }

  if (toManualReview.length > 0) {
    txOps.push(
      prisma.fbaRefund.updateMany({
        where: { id: { in: toManualReview } },
        data: {
          validationStatus: 'MANUAL_REVIEW',
          validationReason: 'Multi-unit or multi-line order — requires manual review',
          validationSource: 'auto',
        },
      }),
    )
  }

  if (withinWindow.length > 0) {
    txOps.push(
      prisma.fbaRefund.updateMany({
        where: { id: { in: withinWindow } },
        data: {
          validationReason: 'Within the 60 day window',
          validationSource: 'auto',
        },
      }),
    )
  }

  if (txOps.length > 0) {
    await prisma.$transaction(txOps)
  }

  let validated = 0
  for (const [, ids] of Array.from(reasonGroups.entries())) {
    validated += ids.length
  }

  return { validated, manualReview: toManualReview.length, withinWindow: withinWindow.length, unchanged }
}
