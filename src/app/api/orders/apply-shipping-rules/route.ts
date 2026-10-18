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
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

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
  })
  if (rules.length === 0) return NextResponse.json({ error: 'No active Back Market shipping rules defined' }, { status: 400 })

  const defaultPreset = await prisma.packagePreset.findFirst({ where: { isDefault: true } })

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds }, orderSource: 'backmarket' },
    include: { items: true, appliedPackagePreset: true },
  })

  const origin = req.nextUrl.origin
  const cookie = req.headers.get('cookie') ?? ''

  // Resolve the origin warehouse — rate-shop quotes UPS/FedEx direct from the
  // from-address, and V2 ShipStation from the warehouse_id, so both are required.
  let warehouse: { warehouseId: number; name: string; phone: string | null; address1: string; city: string; state: string; postal: string; country: string } | null = null
  try {
    const ssAcct = await prisma.shipStationAccount.findFirst({
      where: { isActive: true }, orderBy: { createdAt: 'asc' },
      select: { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
    })
    if (ssAcct) {
      const ssClient = new ShipStationClient(decrypt(ssAcct.apiKeyEnc), ssAcct.apiSecretEnc ? decrypt(ssAcct.apiSecretEnc) : '', ssAcct.v2ApiKeyEnc ? decrypt(ssAcct.v2ApiKeyEnc) : null)
      const whs = await ssClient.getWarehouses().catch(() => [])
      const wh = whs.find(w => w.warehouseName.toUpperCase().includes('MERIDIAN')) ?? whs.find(w => w.isDefault) ?? whs[0]
      if (wh) warehouse = {
        warehouseId: wh.warehouseId, name: wh.originAddress.name, phone: wh.originAddress.phone ?? null,
        address1: wh.originAddress.street1, city: wh.originAddress.city, state: wh.originAddress.state,
        postal: wh.originAddress.postalCode, country: wh.originAddress.country ?? 'US',
      }
    }
  } catch { /* leave null — rate-shop will error per order with a clear message */ }
  if (!warehouse) return NextResponse.json({ error: 'No ShipStation warehouse found for the origin address' }, { status: 400 })

  // Rate-shop one order with a given package preset (reuses the shared route).
  async function rateShop(order: typeof orders[number], preset: NonNullable<typeof orders[number]['appliedPackagePreset']>, confirmation: string, upsCredentialId: string | null, fedexPackaging: string | null): Promise<SSRate[]> {
    const payload = {
      amazonOrderId: order.amazonOrderId,
      orderSource: 'backmarket',
      orderId: undefined as string | undefined,
      ...(upsCredentialId ? { upsCredentialId } : {}),
      ...(fedexPackaging ? { fedexPackaging } : {}),
      warehouseId: warehouse!.warehouseId,
      fromName: warehouse!.name,
      fromPhone: warehouse!.phone ?? undefined,
      fromAddress1: warehouse!.address1,
      fromCity: warehouse!.city,
      fromState: warehouse!.state,
      fromPostalCode: warehouse!.postal,
      fromCountry: warehouse!.country,
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
      const wantOneRate = rule.thenFedexOneRate
      return rates.find(r => r.carrierCode === 'fedex_direct' && r.serviceCode === rule.thenServiceCode
        && (wantOneRate ? /one rate/i.test(r.serviceName) : !/one rate/i.test(r.serviceName))) ?? null
    }
    // shipstation — match by service code, then loosen to carrier + service name.
    return rates.find(r => r.carrierCode !== 'ups_direct' && r.carrierCode !== 'fedex_direct' && r.serviceCode.toLowerCase() === svc)
      ?? rates.find(r => r.carrierCode !== 'ups_direct' && r.carrierCode !== 'fedex_direct'
        && (rule.thenCarrierCode ? (r.carrierCode.toLowerCase().includes(rule.thenCarrierCode.toLowerCase().replace(/^se-/, '')) || (r.carrierName ?? '').toLowerCase().includes(rule.thenCarrierCode.toLowerCase())) : true)
        && (rule.thenServiceName ? r.serviceName.toLowerCase().includes(rule.thenServiceName.toLowerCase()) : true))
      ?? null
  }

  interface RateEvent {
    type: 'rate'; orderId: string; olmNumber: number | null; amazonOrderId: string; applied: boolean
    ruleName?: string; rateAmount?: number | null; rateCarrier?: string | null; rateService?: string | null; rateId?: string | null; error?: string | null
  }

  // Evaluate the rulesets for one order, apply the first full match, return an event.
  async function processOrder(order: typeof orders[number]): Promise<RateEvent> {
    const base = { type: 'rate' as const, orderId: order.id, olmNumber: order.olmNumber, amazonOrderId: order.amazonOrderId }
    try {
      const quotePreset = order.appliedPackagePreset ?? defaultPreset
      if (!quotePreset) return { ...base, applied: false, error: 'No package preset applied to this order' }

      const rateCache = new Map<string, SSRate[]>()
      for (const rule of rules) {
        if (rule.presetEnabled && !(order.appliedPackagePresetId && rule.packagePresetIds.includes(order.appliedPackagePresetId))) continue
        const conf = rule.thenConfirmation ?? 'none'
        // Use the rule's linked UPS account so UPS Direct quotes its negotiated rates.
        const upsCredId = rule.thenCarrierType === 'ups_direct' ? (rule.thenUpsCredentialId ?? null) : null
        // FedEx One Rate packaging for THIS order — per-preset map wins, else the single value.
        let fedexPkg: string | null = null
        if (rule.thenCarrierType === 'fedex_direct' && rule.thenFedexOneRate) {
          const map = (rule.thenFedexPackagingMap as Record<string, string> | null) ?? null
          fedexPkg = (order.appliedPackagePresetId && map?.[order.appliedPackagePresetId]) || rule.thenFedexPackaging || null
        }
        const cacheKey = `${conf}::${upsCredId ?? ''}::${fedexPkg ?? ''}`
        let rates = rateCache.get(cacheKey)
        if (!rates) { rates = await rateShop(order, quotePreset, conf, upsCredId, fedexPkg); rateCache.set(cacheKey, rates) }

        let pass = true
        if (rule.transitEnabled) {
          // Prefer a UPS Ground rate that carries transit info (UPS Direct now
          // does; a ShipStation UPS Ground may not), else any UPS Ground.
          const grounds = rates.filter(isUpsGround)
          const ground = grounds.find(g => g.transitDays != null || g.deliveryDate) ?? grounds[0]
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

        const rate = matchThen(rates, rule)
        if (!rate) return { ...base, applied: false, ruleName: rule.name, error: `Rule "${rule.name}" matched but ${rule.thenServiceName ?? rule.thenServiceCode} was not available` }

        const amount = rate.shipmentCost + rate.otherCost
        await prisma.order.update({
          where: { id: order.id },
          data: {
            presetRateAmount: amount,
            presetRateCarrier: rate.carrierCode,
            presetRateService: rate.serviceName,
            presetRateId: rate.rate_id ?? null,
            presetRateError: null,
            presetRateCheckedAt: new Date(),
            presetRateUpsCredentialId: rule.thenCarrierType === 'ups_direct' ? rule.thenUpsCredentialId : null,
            presetRateConfirmation: rule.thenConfirmation ?? null,
            presetRateFedexOneRate: rule.thenCarrierType === 'fedex_direct' ? rule.thenFedexOneRate : null,
            presetRateFedexPackaging: fedexPkg,
          },
        })
        return { ...base, applied: true, ruleName: rule.name, rateAmount: amount, rateCarrier: rate.carrierCode, rateService: rate.serviceName, rateId: rate.rate_id ?? null }
      }
      return { ...base, applied: false, error: 'No rule matched (conditions not all met)' }
    } catch (e) {
      return { ...base, applied: false, error: e instanceof Error ? e.message : 'Error' }
    }
  }

  // Stream per-order results so the grid shows each rating as it lands.
  const encoder = new TextEncoder()
  const CONCURRENCY = 4
  let applied = 0
  const stream = new ReadableStream({
    async start(controller) {
      const send = (d: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(d)}\n\n`))
      const queue = [...orders]
      const worker = async () => {
        for (;;) {
          const order = queue.shift()
          if (!order) return
          const ev = await processOrder(order)
          if (ev.applied) applied++
          send(ev)
        }
      }
      try {
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, orders.length) }, worker))
        send({ type: 'done', applied, total: orders.length })
      } catch (e) {
        send({ type: 'error', error: e instanceof Error ? e.message : 'Failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
