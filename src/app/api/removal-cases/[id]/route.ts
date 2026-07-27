import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const rc = await prisma.fbaRemovalCase.findUnique({
    where: { id },
    include: { createdBy: { select: { name: true } } },
  })

  if (!rc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rc)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const data: Prisma.FbaRemovalCaseUpdateInput = {}
  if ('note' in body) data.note = body.note || null
  if ('images' in body) data.images = body.images

  // Workflow transitions (see RemovalCaseStatus lifecycle). Each action is validated
  // against the current status so the case can't skip or reverse steps.
  const action = typeof body.action === 'string' ? body.action : null
  if (action) {
    const current = await prisma.fbaRemovalCase.findUnique({
      where: { id },
      select: { status: true },
    })
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (action === 'CREATE_CASE') {
      const amazonCaseId = typeof body.amazonCaseId === 'string' ? body.amazonCaseId.trim() : ''
      if (!amazonCaseId) {
        return NextResponse.json({ error: 'Amazon Case ID is required' }, { status: 400 })
      }
      if (current.status !== 'CASE_NOT_CREATED') {
        return NextResponse.json({ error: 'A case has already been created for this removal case' }, { status: 409 })
      }
      data.status = 'CASE_CREATED'
      data.amazonCaseId = amazonCaseId
    } else if (action === 'DENY_REIMBURSEMENT') {
      if (current.status !== 'CASE_CREATED') {
        return NextResponse.json({ error: 'Case must be in "Case Created" status to resolve' }, { status: 409 })
      }
      data.status = 'REIMBURSEMENT_DENIED'
      data.reimbursementId = null
      data.reimbursementAmount = null
    } else if (action === 'RESOLVE_REIMBURSED') {
      const reimbursementId = typeof body.reimbursementId === 'string' ? body.reimbursementId.trim() : ''
      const amountRaw = body.reimbursementAmount
      const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw)
      if (!reimbursementId) {
        return NextResponse.json({ error: 'Reimbursement ID is required' }, { status: 400 })
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'A valid reimbursement amount greater than 0 is required' }, { status: 400 })
      }
      if (current.status !== 'CASE_CREATED') {
        return NextResponse.json({ error: 'Case must be in "Case Created" status to resolve' }, { status: 409 })
      }
      data.status = 'RESOLVED_REIMBURSED'
      data.reimbursementId = reimbursementId
      data.reimbursementAmount = new Prisma.Decimal(amount.toFixed(2))
    } else {
      return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 })
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.fbaRemovalCase.update({
    where: { id },
    data,
    include: { createdBy: { select: { name: true } } },
  })

  return NextResponse.json(updated)
}
