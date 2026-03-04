/**
 * GET /api/cron/backup-db — Vercel Cron (daily)
 *
 * Creates a Neon branch snapshot as a database backup.
 * Deletes backup branches older than 7 days to avoid clutter.
 */
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

const NEON_PROJECT_ID = 'odd-flower-15181664'
const NEON_API = 'https://console.neon.tech/api/v2'
const BACKUP_PREFIX = 'backup-'
const RETENTION_DAYS = 7

async function neonFetch(path: string, options: RequestInit = {}) {
  const apiKey = process.env.NEON_API_KEY
  if (!apiKey) throw new Error('NEON_API_KEY is not set')

  const res = await fetch(`${NEON_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Neon API ${res.status}: ${body}`)
  }

  return res.json()
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 1. Create a backup branch named backup-YYYY-MM-DD
    const today = new Date().toISOString().slice(0, 10)
    const branchName = `${BACKUP_PREFIX}${today}`

    console.log(`[backup-db] Creating branch: ${branchName}`)

    const created = await neonFetch(`/projects/${NEON_PROJECT_ID}/branches`, {
      method: 'POST',
      body: JSON.stringify({ branch: { name: branchName } }),
    })

    const newBranchId = created.branch?.id
    console.log(`[backup-db] Created branch ${branchName} (${newBranchId})`)

    // 2. List all branches and delete old backups
    const { branches } = await neonFetch(`/projects/${NEON_PROJECT_ID}/branches`) as {
      branches: { id: string; name: string; created_at: string }[]
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const deleted: string[] = []

    for (const branch of branches) {
      if (!branch.name.startsWith(BACKUP_PREFIX)) continue
      if (branch.id === newBranchId) continue

      const createdAt = new Date(branch.created_at)
      if (createdAt < cutoff) {
        console.log(`[backup-db] Deleting old backup: ${branch.name} (${branch.id})`)
        await neonFetch(`/projects/${NEON_PROJECT_ID}/branches/${branch.id}`, {
          method: 'DELETE',
        })
        deleted.push(branch.name)
      }
    }

    return NextResponse.json({
      created: branchName,
      branchId: newBranchId,
      deletedOldBackups: deleted,
    })
  } catch (err) {
    console.error('[backup-db]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Backup failed' },
      { status: 500 },
    )
  }
}
