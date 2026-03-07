/**
 * POST /api/fba-refunds/auto-validate
 * Triggers auto-validation of all UNVALIDATED FBA refunds.
 */
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { autoValidateFbaRefunds } from '@/lib/fba-auto-validate'

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await autoValidateFbaRefunds()
  return NextResponse.json(result)
}
