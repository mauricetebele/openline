/**
 * POST /api/wholesale/customer-rma/[id]/receive-bulk
 * Bulk-receive a wholesale return from a pasted list of serial numbers, in two
 * phases:
 *   { serialNumbers, commit: false }            → STAGE: validate only, no writes.
 *   { serialNumbers, locationId, commit: true } → COMMIT: receive the matched ones.
 *
 * The stage response categorises every pasted serial against the return so the UI
 * can prevent over-receiving and flag under-receiving:
 *   receivable      — on this return and not yet received (will be received)
 *   alreadyReceived — on this return but already received (skipped)
 *   notOnReturn     — NOT on this return (over-receiving — rejected)
 *   duplicates      — the same serial pasted more than once
 *   missing         — on the return, not yet received, and NOT in the paste
 *                     (under-receiving — short)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { pushQtyForProducts } from '@/lib/push-qty-for-product'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const norm = (s: string) => s.trim().toUpperCase()

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { serialNumbers?: unknown; locationId?: string; commit?: boolean }
  const raw = Array.isArray(body.serialNumbers) ? body.serialNumbers : []
  const commit = body.commit === true

  // De-duplicate the pasted list (case-insensitive), tracking duplicates.
  const seen = new Set<string>()
  const duplicates: string[] = []
  const pasted: { input: string; key: string }[] = []
  for (const v of raw) {
    const input = typeof v === 'string' ? v.trim() : ''
    if (!input) continue
    const key = norm(input)
    if (seen.has(key)) { duplicates.push(input); continue }
    seen.add(key)
    pasted.push({ input, key })
  }
  if (pasted.length === 0) return NextResponse.json({ error: 'Paste at least one serial number' }, { status: 400 })

  // Load the return's serials.
  const rma = await prisma.customerRMA.findUnique({
    where: { id: params.id },
    select: { id: true, status: true },
  })
  if (!rma) return NextResponse.json({ error: 'Return not found' }, { status: 404 })

  const rmaSerials = await prisma.customerRMASerial.findMany({
    where: { rmaId: params.id },
    select: {
      id: true, serialNumber: true, receivedAt: true, productId: true, gradeId: true, salesOrderId: true,
      inventorySerial: { select: { id: true, productId: true } },
    },
  })
  const byKey = new Map(rmaSerials.map(s => [norm(s.serialNumber), s]))

  // Categorise the pasted serials.
  const receivable: typeof rmaSerials = []
  const alreadyReceived: string[] = []
  const notOnReturn: string[] = []
  for (const p of pasted) {
    const match = byKey.get(p.key)
    if (!match) notOnReturn.push(p.input)
    else if (match.receivedAt) alreadyReceived.push(p.input)
    else receivable.push(match)
  }

  // Under-receiving: not-yet-received return serials that weren't pasted.
  const pastedKeys = new Set(pasted.map(p => p.key))
  const missing = rmaSerials
    .filter(s => !s.receivedAt && !pastedKeys.has(norm(s.serialNumber)))
    .map(s => s.serialNumber)

  const summary = {
    receivable: receivable.map(s => s.serialNumber),
    alreadyReceived,
    notOnReturn,
    duplicates,
    missing,
    counts: {
      pasted: pasted.length,
      receivable: receivable.length,
      alreadyReceived: alreadyReceived.length,
      notOnReturn: notOnReturn.length,
      missing: missing.length,
      totalOnReturn: rmaSerials.length,
      alreadyReceivedOnReturn: rmaSerials.filter(s => s.receivedAt).length,
    },
  }

  // Stage: validation only, no writes.
  if (!commit) return NextResponse.json({ staged: true, ...summary })

  // Commit: receive the matched serials.
  if (!body.locationId) return NextResponse.json({ error: 'locationId is required to receive' }, { status: 400 })
  if (receivable.length === 0) return NextResponse.json({ error: 'No matching unreceived serials to receive' }, { status: 400 })
  const locationId = body.locationId
  const now = new Date()
  const productIds = new Set<string>()

  await prisma.$transaction(async (tx) => {
    for (const rs of receivable) {
      productIds.add(rs.productId)
      await tx.customerRMASerial.update({ where: { id: rs.id }, data: { receivedAt: now, receivedLocationId: locationId } })
      if (rs.inventorySerial) {
        await tx.inventorySerial.update({ where: { id: rs.inventorySerial.id }, data: { status: 'IN_STOCK', locationId } })
      }
      await tx.inventoryItem.upsert({
        where: { productId_locationId_gradeId: { productId: rs.productId, locationId, gradeId: rs.gradeId ?? '' } },
        create: { productId: rs.productId, locationId, gradeId: rs.gradeId, qty: 1 },
        update: { qty: { increment: 1 } },
      })
      if (rs.salesOrderId && rs.inventorySerial) {
        await tx.salesOrderSerialAssignment.deleteMany({ where: { serialId: rs.inventorySerial.id } })
      }
      if (rs.inventorySerial) {
        await tx.serialHistory.create({
          data: {
            inventorySerialId: rs.inventorySerial.id,
            eventType: 'WHOLESALE_RMA_RETURN',
            locationId,
            notes: 'Bulk RMA return received',
            userId: user.dbId,
          },
        })
      }
    }
  }, { timeout: 60_000 })

  const unreceived = await prisma.customerRMASerial.count({ where: { rmaId: params.id, receivedAt: null } })
  if (unreceived === 0) {
    await prisma.customerRMA.update({ where: { id: params.id }, data: { status: 'RECEIVED' } })
  }
  pushQtyForProducts(Array.from(productIds))

  return NextResponse.json({ committed: true, received: receivable.length, allReceived: unreceived === 0, ...summary })
}
