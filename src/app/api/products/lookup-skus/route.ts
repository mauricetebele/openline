/**
 * POST /api/products/lookup-skus
 * Body: { skus: string[] }  (max 200)
 *
 * Looks up products by internal SKU and returns inventory grouped by grade.
 * Used by the bulk listing creator to auto-expand rows per grade.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

const bodySchema = z.object({
  skus: z.array(z.string().min(1)).min(1).max(200),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
    }

    const { skus } = parsed.data
    const uniqueSkus = Array.from(new Set(skus.map(s => s.trim()).filter(Boolean)))

    // Fetch matching products
    const products = await prisma.product.findMany({
      where: { sku: { in: uniqueSkus }, archivedAt: null },
      select: { id: true, sku: true, description: true },
    })

    const productIds = products.map(p => p.id)
    const productMap = new Map(products.map(p => [p.id, p]))

    // Group inventory by product+grade (only items with qty > 0)
    const inventoryGroups = await prisma.inventoryItem.groupBy({
      by: ['productId', 'gradeId'],
      where: { productId: { in: productIds }, qty: { gt: 0 } },
      _sum: { qty: true },
    })

    // Collect all grade IDs to look up names
    const gradeIds = inventoryGroups
      .map(g => g.gradeId)
      .filter((id): id is string => id !== null)
    const grades = gradeIds.length > 0
      ? await prisma.grade.findMany({
          where: { id: { in: Array.from(new Set(gradeIds)) } },
          select: { id: true, grade: true },
        })
      : []
    const gradeMap = new Map(grades.map(g => [g.id, g.grade]))

    // Build per-product grade arrays
    const productGrades = new Map<string, { gradeId: string | null; gradeName: string | null; availableQty: number }[]>()
    for (const group of inventoryGroups) {
      const arr = productGrades.get(group.productId) ?? []
      arr.push({
        gradeId: group.gradeId,
        gradeName: group.gradeId ? (gradeMap.get(group.gradeId) ?? null) : null,
        availableQty: group._sum.qty ?? 0,
      })
      productGrades.set(group.productId, arr)
    }

    // Build found array
    const foundSkus = new Set<string>()
    const found = products.map(p => {
      foundSkus.add(p.sku.toLowerCase())
      return {
        product: { id: p.id, sku: p.sku, description: p.description },
        grades: (productGrades.get(p.id) ?? []).sort((a, b) => {
          if (!a.gradeName) return 1
          if (!b.gradeName) return -1
          return a.gradeName.localeCompare(b.gradeName)
        }),
      }
    })

    // Determine not-found SKUs
    const notFound = uniqueSkus.filter(s => !foundSkus.has(s.toLowerCase()))

    return NextResponse.json({ found, notFound })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/products/lookup-skus]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
