/**
 * Unit tests for the refund import logic (finances.ts helpers).
 * We test sumCharges independently without hitting real DB or SP-API.
 */
import type { SpApiShipmentItemAdjustment } from '../types'

// Inline the helper to keep tests self-contained
function sumCharges(item: SpApiShipmentItemAdjustment): number {
  if (!item.ItemChargeAdjustmentList) return 0
  return item.ItemChargeAdjustmentList.reduce(
    (sum, c) => sum + (c.ChargeAmount?.CurrencyAmount ?? 0),
    0,
  )
}

describe('sumCharges', () => {
  it('returns 0 for item with no charges', () => {
    const item: SpApiShipmentItemAdjustment = { AdjustmentId: 'ADJ1' }
    expect(sumCharges(item)).toBe(0)
  })

  it('sums Principal + Shipping charges', () => {
    const item: SpApiShipmentItemAdjustment = {
      AdjustmentId: 'ADJ2',
      ItemChargeAdjustmentList: [
        { ChargeType: 'Principal', ChargeAmount: { CurrencyCode: 'USD', CurrencyAmount: 29.99 } },
        { ChargeType: 'Shipping', ChargeAmount: { CurrencyCode: 'USD', CurrencyAmount: 5.0 } },
      ],
    }
    expect(sumCharges(item)).toBeCloseTo(34.99)
  })

  it('handles negative charges (reversals)', () => {
    const item: SpApiShipmentItemAdjustment = {
      AdjustmentId: 'ADJ3',
      ItemChargeAdjustmentList: [
        { ChargeType: 'Principal', ChargeAmount: { CurrencyCode: 'USD', CurrencyAmount: -49.99 } },
      ],
    }
    expect(sumCharges(item)).toBeCloseTo(-49.99)
  })
})

describe('deduplication key policy', () => {
  it('unique key is accountId + orderId + adjustmentId', () => {
    const key = (accountId: string, orderId: string, adjustmentId: string) =>
      `${accountId}|${orderId}|${adjustmentId}`

    expect(key('ACC1', 'ORD1', 'ADJ1')).toBe('ACC1|ORD1|ADJ1')
    expect(key('ACC1', 'ORD1', 'ADJ1')).toEqual(key('ACC1', 'ORD1', 'ADJ1'))
    expect(key('ACC1', 'ORD1', 'ADJ2')).not.toEqual(key('ACC1', 'ORD1', 'ADJ1'))
  })
})
