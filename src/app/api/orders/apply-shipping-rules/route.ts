/**
 * POST /api/orders/apply-shipping-rules   { orderIds: string[] }
 *
 * Back Market shipping logic. For each order, active rulesets are evaluated by
 * priority (lowest first). A ruleset's conditions ("ifs") are AND'd — the rate
 * shop only proceeds when ALL enabled conditions pass. The first fully-matching
 * rule's "then" shipping method is rate-shopped (using the rule's package preset
 * for dims) and written onto the order's preset-rate fields; you review & buy.
 *
 * Conditions:
 *   - UPS Ground transit:  (UPS Ground business-day transit <= transitMaxDays)
 *                          must equal transitWithin.
 *   - Order value:         orderTotal <op> valueAmount.
 *
 * Rates come from the shared /api/shipstation/rate-shop route (reused so carrier
 * logic isn't duplicated), which returns all carriers' rates with transit days.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface SSRate {
  serviceName: string; serviceCode: string; carrierCode: string; carrierName?: string
  shipmentCost: number; otherCost: number; transitDays: number | null; deliveryDate: string | null; rate_id?: string
}

function businessDaysBetween(from: Date, to: Date): number {
  let days = 0
  const d = new Date(from); d.setHours(0, 0, 0, 0)
  const end = new Date(to); end.setHours(0, 0, 0, 0)
  while (d < end) { d.setDate(d.getDate() + 1); const dow = d.getDay(); if (dow !== 0 && dow !== 6) days++ }
  return days
}

const isUpsGround = (r: SSRate) =>
  /ground/i.test(r.serviceName) && (/ups/i.test(r.carrierCode) || /ups/i.test(r.carrierName ?? ''))

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const body = await req.json().catch(() => null) as { orderIds?: string[]; shipDate?: string } | null
  const orderIds = body?.orderIds?.filter(Boolean) ?? []
  if (orderIds.length === 0) return NextResponse.json({ error: 'orderIds is required' }, { status: 400 })
  const shipDate = body?.shipDate ?? new Date().toISOString().slice(0, 10)

  const rules = await prisma.shippingRule.findMany({
    where: { active: true, orderSource: 'backmarket' },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    include: { packagePreset: true },
  })
  if (rules.length === 0) return NextResponse.json({ error: 'No active Back Market shipping rules defined' }, { status: 400 })

  const defaultPreset = await prisma.packagePreset.findFirst({ where: { isDefault: true } })

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds }, orderSource: 'backmarket' },
    include: { items: true, appliedPackagePreset: true },
  })

  const origin = req.nextUrl.origin
  const cookie = req.headers.get('cookie') ?? ''

  // Rate-shop one order with a given package preset (reuses the shared route).
  async function rateShop(order: typeof orders[number], preset: NonNullable<typeof orders[number]['appliedPackagePreset']>, confirmation: string): Promise<SSRate[]> {
    const payload = {
      amazonOrderId: order.amazonOrderId,
      orderSource: 'backmarket',
      orderId: undefined as string | undefined,
      toName: order.shipToName ?? undefined,
      toAddress1: order.shipToAddress1 ?? '',
      toAddress2: order.shipToAddress2 ?? undefined,
      toCity: order.shipToCity ?? '',
      toState: order.shipToState ?? '',
      toPostalCode: (order.shipToPostal ?? '').split('-')[0].trim(),
      toCountry: order.shipToCountry ?? 'US',
      toPhone: order.shipToPhone ?? undefined,
      residential: true,
      weight: { value: preset.weightValue, units: preset.weightUnit },
      dimensions: { units: preset.dimUnit, length: preset.dimLength ?? 0, width: preset.dimWidth ?? 0, height: preset.dimHeight ?? 0 },
      confirmation: confirmation || preset.confirmation || 'none',
      ...(preset.packageCode ? { packageCode: preset.packageCode } : {}),
      shipDate,
      orderItems: order.items.map(i => ({ orderItemId: i.orderItemId, title: i.title, quantity: i.quantityOrdered })),
    }
    const res = await fetch(`${origin}/api/shipstation/rate-shop`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `rate-shop ${res.status}`)
    const data = await res.json()
    return Array.isArray(data.rates) ? data.rates : []
  }

  // Find the rate matching a rule's "then" method.
  function matchThen(rates: SSRate[], rule: typeof rules[number]): SSRate | null {
    const svc = rule.thenServiceCode.toLowerCase()
    if (rule.thenCarrierType === 'ups_direct') {
      return rates.find(r => r.carrierCode === 'ups_direct' && r.serviceCode === rule.thenServiceCode) ?? null
    }
    if (rule.thenCarrierType === 'fedex_direct') {
      return rates.find(r => r.carrierCode === 'fedex_direct' && r.serviceCode === rule.thenServiceCode) ?? null
    }
    // shipstation — match by service code, then loosen to carrier + service name.
    return rates.find(r => r.carrierCode !== 'ups_direct' && r.carrierCode !== 'fedex_direct' && r.serviceCode.toLowerCase() === svc)
      ?? rates.find(r => r.carrierCode !== 'ups_direct' && r.carrierCode !== 'fedex_direct'
        && (rule.thenCarrierCode ? (r.carrierCode.toLowerCase().includes(rule.thenCarrierCode.toLowerCase().replace(/^se-/, '')) || (r.carrierName ?? '').toLowerCase().includes(rule.thenCarrierCode.toLowerCase())) : true)
        && (rule.thenServiceName ? r.serviceName.toLowerCase().includes(rule.thenServiceName.toLowerCase()) : true))
      ?? null
  }

  const results: { orderId: string; olmNumber: number | null; amazonOrderId: string; applied: boolean; ruleName?: string; carrier?: string; service?: string; amount?: number; reason?: string }[] = []

  for (const order of orders) {
    try {
      // The rate quote uses the ORDER's own applied package preset for dims.
      const quotePreset = order.appliedPackagePreset ?? defaultPreset
      if (!quotePreset) {
        results.push({ orderId: order.id, olmNumber: order.olmNumber, amazonOrderId: order.amazonOrderId, applied: false, reason: 'No package preset applied to this order' })
        continue
      }
      const rateCache = new Map<string, SSRate[]>()
      let matched = false

      for (const rule of rules) {
        // IF: order's applied package preset equals the rule's preset.
        if (rule.presetEnabled && order.appliedPackagePresetId !== rule.packagePresetId) continue

        const conf = rule.thenConfirmation ?? 'none'
        let rates = rateCache.get(conf)
        if (!rates) { rates = await rateShop(order, quotePreset, conf); rateCache.set(conf, rates) }

        // Evaluate conditions (AND).
        let pass = true
        if (rule.transitEnabled) {
          const ground = rates.find(isUpsGround)
          let within: boolean | null = null
          if (ground) {
            let days = ground.transitDays
            if (days == null && ground.deliveryDate) days = businessDaysBetween(new Date(shipDate), new Date(ground.deliveryDate))
            if (days != null) within = days <= (rule.transitMaxDays ?? 2)
          }
          if (within === null || within !== rule.transitWithin) pass = false
        }
        if (pass && rule.valueEnabled && rule.valueAmount != null) {
          const total = order.orderTotal != null ? Number(order.orderTotal) : null
          const x = Number(rule.valueAmount)
          const ok = total != null && (
            rule.valueOperator === 'gt' ? total > x :
            rule.valueOperator === 'lt' ? total < x :
            rule.valueOperator === 'gte' ? total >= x :
            rule.valueOperator === 'lte' ? total <= x : false)
          if (!ok) pass = false
        }
        if (!pass) continue

        // All ifs yes → apply this rule's then-method.
        const rate = matchThen(rates, rule)
        if (!rate) {
          results.push({ orderId: order.id, olmNumber: order.olmNumber, amazonOrderId: order.amazonOrderId, applied: false, ruleName: rule.name, reason: `Rule matched but "${rule.thenServiceName ?? rule.thenServiceCode}" was not available for this order` })
          matched = true
          break
        }
        await prisma.order.update({
          where: { id: order.id },
          data: {
            presetRateAmount: rate.shipmentCost + rate.otherCost,
            presetRateCarrier: rate.carrierCode,
            presetRateService: rate.serviceCode,
            presetRateId: rate.rate_id ?? null,
            presetRateError: null,
            presetRateCheckedAt: new Date(),
            presetRateUpsCredentialId: rule.thenCarrierType === 'ups_direct' ? rule.thenUpsCredentialId : null,
            presetRateConfirmation: rule.thenConfirmation ?? null,
          },
        })
        results.push({ orderId: order.id, olmNumber: order.olmNumber, amazonOrderId: order.amazonOrderId, applied: true, ruleName: rule.name, carrier: rate.carrierName ?? rate.carrierCode, service: rate.serviceName, amount: rate.shipmentCost + rate.otherCost })
        matched = true
        break
      }

      if (!matched) {
        results.push({ orderId: order.id, olmNumber: order.olmNumber, amazonOrderId: order.amazonOrderId, applied: false, reason: 'No rule matched (conditions not all met)' })
      }
    } catch (e) {
      results.push({ orderId: order.id, olmNumber: order.olmNumber, amazonOrderId: order.amazonOrderId, applied: false, reason: e instanceof Error ? e.message : 'Error' })
    }
  }

  const applied = results.filter(r => r.applied).length
  return NextResponse.json({ applied, total: results.length, results })
}
