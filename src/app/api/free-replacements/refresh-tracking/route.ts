export const maxDuration = 120

import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { refreshStaleTracking } from '@/lib/amazon/sync-replacements'

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const refreshed = await refreshStaleTracking()

  return NextResponse.json({ ok: true, refreshed })
}
