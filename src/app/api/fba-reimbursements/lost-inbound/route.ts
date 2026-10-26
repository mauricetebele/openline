/**
 * GET  /api/fba-reimbursements/lost-inbound
 *   Lists every Lost_Inbound reimbursement (grouped by reimbursement id) with its
 *   current shipment attribution, plus the shipments available to attribute to.
 *   Amazon's reimbursement report has no shipment id — only a case-id whose title
 *   (on Seller Central) names the shipment — so attribution is done by hand here.
 *
 * POST /api/fba-reimbursements/lost-inbound   { reimbursementId, accountId, shipmentId }
 *   Attributes (or clears, when shipmentId is null) every row of a reimbursement
 *   to an inbound shipment.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const filter = req.nextUrl.searchParams.get('status') ?? 'all' // all | attributed | unattributed

  const rows = await prisma.fbaReimbursement.findMany({
    where: { reason: 'Lost_Inbound' },
    select: {
      accountId: true, reimbursementId: true, caseId: true, sku: true, fnsku: true,
      quantityReimbursedTotal: true, amountTotal: true, currencyUnit: true, approvalDate: true,
      attributedShipmentId: true, attributedShipmentExternalId: true, attributedAt: true,
      attributedShipment: { select: { shipmentNumber: true, name: true } },
      account: { select: { marketplaceName: true } },
    },
    orderBy: { approvalDate: 'desc' },
  })

  // Group by (accountId, reimbursementId) — a case may reimburse several SKUs.
  const groups = new Map<string, {
    accountId: string; reimbursementId: string; caseId: string | null; marketplaceName: string | null
    approvalDate: Date | null; currency: string | null
    lines: { sku: string; fnsku: string | null; quantity: number; amount: number | null }[]
    totalQty: number; totalAmount: number
    attributedShipmentId: string | null; attributedShipmentNumber: string | null; attributedShipmentName: string | null
    attributedShipmentExternalId: string | null; attributedAt: Date | null
  }>()

  for (const r of rows) {
    const key = `${r.accountId}::${r.reimbursementId}`
    let g = groups.get(key)
    if (!g) {
      g = {
        accountId: r.accountId, reimbursementId: r.reimbursementId, caseId: r.caseId,
        marketplaceName: r.account?.marketplaceName ?? null,
        approvalDate: r.approvalDate, currency: r.currencyUnit ?? 'USD',
        lines: [], totalQty: 0, totalAmount: 0,
        attributedShipmentId: r.attributedShipmentId,
        attributedShipmentNumber: r.attributedShipment?.shipmentNumber ?? null,
        attributedShipmentName: r.attributedShipment?.name ?? null,
        attributedShipmentExternalId: r.attributedShipmentExternalId ?? null,
        attributedAt: r.attributedAt,
      }
      groups.set(key, g)
    }
    const qty = r.quantityReimbursedTotal ?? 0
    const amt = r.amountTotal != null ? Number(r.amountTotal) : 0
    g.lines.push({ sku: r.sku || '—', fnsku: r.fnsku, quantity: qty, amount: r.amountTotal != null ? Number(r.amountTotal) : null })
    g.totalQty += qty
    g.totalAmount += amt
  }

  // A reimbursement is "attributed" if it's tied to one of our shipments OR carries
  // a free-text external (Seller Central) shipment id.
  const isAttributed = (g: { attributedShipmentId: string | null; attributedShipmentExternalId: string | null }) =>
    !!g.attributedShipmentId || !!g.attributedShipmentExternalId

  let data = Array.from(groups.values())
  if (filter === 'attributed') data = data.filter(isAttributed)
  else if (filter === 'unattributed') data = data.filter(g => !isAttributed(g))

  // Unattributed first, then by most recent approval.
  data.sort((a, b) => {
    const au = isAttributed(a) ? 1 : 0, bu = isAttributed(b) ? 1 : 0
    if (au !== bu) return au - bu
    return (b.approvalDate?.getTime() ?? 0) - (a.approvalDate?.getTime() ?? 0)
  })

  // Shipments available to attribute to (SHIPPED — units are in Amazon's hands).
  const shipments = await prisma.fbaShipment.findMany({
    where: { status: 'SHIPPED' },
    select: { id: true, shipmentNumber: true, name: true, accountId: true, shipmentConfirmationId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  const unattributedCount = Array.from(groups.values()).filter(g => !isAttributed(g)).length
  return NextResponse.json({ rows: data, shipments, counts: { total: groups.size, unattributed: unattributedCount } })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as { reimbursementId?: string; accountId?: string; shipmentId?: string | null; externalShipmentId?: string | null } | null
  const reimbursementId = body?.reimbursementId?.trim()
  const accountId = body?.accountId?.trim()
  const shipmentId = body?.shipmentId ? body.shipmentId.trim() : null
  // `externalShipmentId` is a free-text Amazon inbound id (FBA…) for a shipment not
  // in our system. Only treated as provided when the key is present in the body.
  const hasExternal = body != null && Object.prototype.hasOwnProperty.call(body, 'externalShipmentId')
  const externalShipmentId = body?.externalShipmentId ? body.externalShipmentId.trim() : null
  if (!reimbursementId || !accountId) return NextResponse.json({ error: 'reimbursementId and accountId are required' }, { status: 400 })

  if (shipmentId) {
    const ship = await prisma.fbaShipment.findUnique({ where: { id: shipmentId }, select: { id: true } })
    if (!ship) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  }

  // Setting one attribution kind clears the other (a reimbursement ties to one shipment).
  const data: {
    attributedShipmentId?: string | null; attributedShipmentExternalId?: string | null
    attributedAt: Date | null; attributedById: string | null
  } = hasExternal
    ? { attributedShipmentExternalId: externalShipmentId, attributedShipmentId: null, attributedAt: externalShipmentId ? new Date() : null, attributedById: externalShipmentId ? user.dbId : null }
    : { attributedShipmentId: shipmentId, attributedShipmentExternalId: null, attributedAt: shipmentId ? new Date() : null, attributedById: shipmentId ? user.dbId : null }

  const res = await prisma.fbaReimbursement.updateMany({
    where: { accountId, reimbursementId },
    data,
  })

  return NextResponse.json({ ok: true, updated: res.count })
}
