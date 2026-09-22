import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { detectCarrier } from '@/lib/ups-tracking'

const CARRIER_DISPLAY: Record<string, string> = {
  UPS: 'UPS',
  USPS: 'USPS',
  FEDEX: 'FedEx',
  AMZL: 'Amazon Logistics',
}

/** Normalize carrier to a standard name for filtering */
function normalizeCarrier(display: string | null): string | null {
  if (!display) return null
  const u = display.toUpperCase()
  if (u.includes('UPS')) return 'UPS'
  if (u.includes('FEDEX') || u.includes('FDX')) return 'FedEx'
  if (u.includes('USPS') || u.includes('US POSTAL') || u.includes('STAMPS')) return 'USPS'
  return display
}

/** Resolve a human-readable carrier name from raw fields + tracking number */
function resolveCarrier(rawCarrier: string | null, tracking: string | null): string | null {
  // If we already have a clean carrier name (not a generic placeholder), use it
  if (rawCarrier && !/buy.shipping|amazon_buy/i.test(rawCarrier)) return rawCarrier

  // Detect from tracking number
  if (tracking) {
    const detected = detectCarrier(tracking)
    if (detected !== 'UNKNOWN') return CARRIER_DISPLAY[detected] ?? detected
  }

  return rawCarrier
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  const start = new Date(startDate + 'T00:00:00.000Z')
  const end = new Date(endDate + 'T23:59:59.999Z')

  const [orders, wholesaleOrders, vendorLabels, fbaShipments, repairOrders] = await Promise.all([
    prisma.order.findMany({
      where: {
        workflowStatus: 'SHIPPED',
        // Exclude FBA (AFN) but keep channel-less orders (null) like accessorial
        // shipments — a plain `{ not: 'AFN' }` drops NULL rows in SQL.
        AND: [
          { OR: [{ fulfillmentChannel: { not: 'AFN' } }, { fulfillmentChannel: null }] },
          { OR: [
            { label: { createdAt: { gte: start, lte: end } } },
            { shippedAt: { gte: start, lte: end } },
          ] },
        ],
      },
      select: {
        id: true,
        olmNumber: true,
        amazonOrderId: true,
        orderSource: true,
        shipCarrier: true,
        shipTracking: true,
        shipmentServiceLevel: true,
        shippedAt: true,
        label: {
          select: {
            trackingNumber: true,
            carrier: true,
            serviceCode: true,
            createdAt: true,
          },
        },
      },
      orderBy: [
        { shippedAt: 'desc' },
        { olmNumber: 'desc' },
      ],
    }),
    prisma.salesOrder.findMany({
      where: {
        fulfillmentStatus: 'SHIPPED',
        shippedAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        orderNumber: true,
        invoiceNumber: true,
        shipCarrier: true,
        shipTracking: true,
        shippedAt: true,
        customer: { select: { companyName: true } },
      },
      orderBy: { shippedAt: 'desc' },
    }),
    // Vendor Returns (RTV): one manifest row per purchased label piece — but only
    // once the RMA is actually marked shipped (or later).
    prisma.vendorReturnLabel.findMany({
      where: {
        voided: false,
        createdAt: { gte: start, lte: end },
        vendorRma: { status: { in: ['SHIPPED_AWAITING_CREDIT', 'CREDIT_RECEIVED'] } },
      },
      select: {
        id: true, carrier: true, serviceLabel: true, serviceCode: true, trackingNumber: true, createdAt: true,
        vendorRma: { select: { rmaNumber: true, vendor: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    // FBA inbound shipments (SHIPPED) — one manifest row per box so every box's
    // tracking number gets its own row.
    prisma.fbaShipment.findMany({
      where: {
        status: 'SHIPPED',
        updatedAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        shipmentNumber: true,
        name: true,
        shipmentConfirmationId: true,
        updatedAt: true,
        boxes: {
          select: { id: true, boxNumber: true, trackingNumber: true },
          orderBy: { boxNumber: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    // Repair orders — outbound (to vendor) + inbound (back to us) shipments.
    prisma.repairOrder.findMany({
      where: {
        updatedAt: { gte: start, lte: end },
        OR: [{ outboundTracking: { not: null } }, { inboundTracking: { not: null } }],
      },
      select: {
        orderNumber: true, updatedAt: true,
        outboundCarrier: true, outboundTracking: true, inboundCarrier: true, inboundTracking: true,
        vendor: { select: { companyName: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  const rows = [
    ...orders.map((o) => {
      const tracking = o.label?.trackingNumber || o.shipTracking || null
      const rawCarrier = o.label?.carrier || o.shipCarrier || null
      const carrier = resolveCarrier(rawCarrier, tracking)
      return {
        id: o.id,
        // Accessorial (accessory-shipment) orders use an ACC- order id — surface
        // them as their own source so the manifest can badge them distinctly.
        source: (o.amazonOrderId?.startsWith('ACC-') ? 'accessorial' : 'marketplace') as 'marketplace' | 'accessorial',
        olmNumber: o.olmNumber,
        amazonOrderId: o.amazonOrderId,
        orderSource: o.orderSource,
        orderRef: null as string | null,
        customerName: null as string | null,
        carrier,
        carrierNorm: normalizeCarrier(carrier),
        serviceCode: o.label?.serviceCode || o.shipmentServiceLevel || null,
        shipDate: o.label?.createdAt || o.shippedAt || null,
        trackingNumber: tracking,
      }
    }),
    ...wholesaleOrders.map((so) => {
      const carrier = resolveCarrier(so.shipCarrier, so.shipTracking)
      return {
        id: so.id,
        source: 'wholesale' as const,
        olmNumber: null,
        amazonOrderId: null as string | null,
        orderSource: 'wholesale' as string,
        orderRef: so.invoiceNumber ?? so.orderNumber,
        customerName: so.customer.companyName,
        carrier,
        carrierNorm: normalizeCarrier(carrier),
        serviceCode: null,
        shipDate: so.shippedAt,
        trackingNumber: so.shipTracking,
      }
    }),
    ...vendorLabels.map((l) => {
      const carrier = resolveCarrier(l.carrier === 'ups' ? 'UPS' : l.carrier === 'fedex' ? 'FedEx' : l.carrier, l.trackingNumber)
      return {
        id: l.id,
        source: 'vendorRMA' as const,
        olmNumber: null,
        amazonOrderId: null as string | null,
        orderSource: 'vendorRMA' as string,
        orderRef: l.vendorRma.rmaNumber,       // Order # = VRMA number
        customerName: l.vendorRma.vendor.name,
        carrier,
        carrierNorm: normalizeCarrier(carrier),
        serviceCode: l.serviceLabel ?? l.serviceCode ?? null,
        shipDate: l.createdAt,
        trackingNumber: l.trackingNumber,
      }
    }),
    ...fbaShipments.flatMap((s) => {
      const ref = s.shipmentNumber ?? s.name ?? s.shipmentConfirmationId ?? `FBA-${s.id.slice(-8)}`
      // One row per box that has a tracking number (so every tracking number gets
      // its own row). If none are captured yet, emit a single row so the shipment
      // still appears rather than one blank row per box.
      const tracked = s.boxes.filter((b) => b.trackingNumber)
      const boxRows = tracked.length > 0 ? tracked : [null]
      return boxRows.map((box) => {
        const tracking = box?.trackingNumber ?? null
        const carrier = resolveCarrier(null, tracking)
        return {
          id: box ? box.id : s.id,
          source: 'fba' as const,
          olmNumber: null,
          amazonOrderId: null as string | null,
          orderSource: 'fba' as string,
          orderRef: box && tracked.length > 1 ? `${ref} · Box ${box.boxNumber}` : ref,
          customerName: 'Amazon FBA',
          carrier,
          carrierNorm: normalizeCarrier(carrier),
          serviceCode: 'FBA Inbound',
          shipDate: s.updatedAt,
          trackingNumber: tracking,
        }
      })
    }),
    ...repairOrders.flatMap((r) => {
      const ref = `RO-${String(r.orderNumber).padStart(4, '0')}`
      const legs: { dir: string; carrier: string | null; tracking: string | null }[] = [
        { dir: 'Out → Vendor', carrier: r.outboundCarrier, tracking: r.outboundTracking },
        { dir: 'In → Us', carrier: r.inboundCarrier, tracking: r.inboundTracking },
      ]
      return legs.flatMap((leg) => {
        const nums = (leg.tracking ?? '').split(',').map(t => t.trim()).filter(Boolean)
        return nums.map((tn) => {
          const carrier = resolveCarrier(leg.carrier, tn)
          return {
            id: `${ref}:${tn}`,
            source: 'repair' as const,
            olmNumber: null,
            amazonOrderId: null as string | null,
            orderSource: 'repair' as string,
            orderRef: `${ref} · ${leg.dir}`,
            customerName: r.vendor.companyName,
            carrier,
            carrierNorm: normalizeCarrier(carrier),
            serviceCode: 'Repair',
            shipDate: r.updatedAt,
            trackingNumber: tn,
          }
        })
      })
    }),
  ].sort((a, b) => {
    const da = a.shipDate ? new Date(a.shipDate).getTime() : 0
    const db = b.shipDate ? new Date(b.shipDate).getTime() : 0
    return db - da
  })

  return NextResponse.json(rows)
}
