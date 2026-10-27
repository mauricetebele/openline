/**
 * GET  /api/bm-cases?status=open|resolved|all
 *   Lists Back Market cases, newest first. `status` filters by case status.
 *
 * POST /api/bm-cases   { caseId, orderId?, description, caseUrl? }
 *   Creates a new Back Market case (status defaults to OPEN).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  caseId:      z.string().trim().min(1, 'Case ID is required'),
  orderId:     z.string().trim().optional().nullable(),
  description: z.string().trim().min(1, 'Description is required'),
  caseUrl:     z.string().trim().url('Case URL must be a valid URL').optional().nullable().or(z.literal('')),
})

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const statusParam = (req.nextUrl.searchParams.get('status') ?? 'all').toLowerCase()
  const where =
    statusParam === 'open' ? { status: 'OPEN' as const } :
    statusParam === 'resolved' ? { status: 'RESOLVED' as const } :
    {}

  const rows = await prisma.bmCase.findMany({
    where,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], // OPEN before RESOLVED, newest first
  })

  const counts = await prisma.bmCase.groupBy({ by: ['status'], _count: true })
  const open = counts.find(c => c.status === 'OPEN')?._count ?? 0
  const resolved = counts.find(c => c.status === 'RESOLVED')?._count ?? 0

  return NextResponse.json({ rows, counts: { open, resolved, total: open + resolved } })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
  }
  const { caseId, orderId, description, caseUrl } = parsed.data

  const created = await prisma.bmCase.create({
    data: {
      caseId,
      orderId: orderId?.trim() || null,
      description,
      caseUrl: caseUrl?.trim() || null,
      createdBy: user.email,
      updatedBy: user.email,
    },
  })

  return NextResponse.json(created, { status: 201 })
}
