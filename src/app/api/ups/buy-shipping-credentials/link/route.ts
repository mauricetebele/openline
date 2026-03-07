/**
 * POST /api/ups/buy-shipping-credentials/link
 * Spawns the Playwright link-ups script as a local child process.
 * Only works in development (the script opens a real browser window).
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { spawn } from 'child_process'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'This action can only be run locally (dev mode). Use: npm run link-ups' },
      { status: 400 },
    )
  }

  const projectRoot = path.resolve(process.cwd())

  const child = spawn(
    'npm',
    ['run', 'link-ups'],
    {
      cwd: projectRoot,
      detached: true,
      stdio: 'ignore',
    },
  )

  // Let the child process run independently of the Next.js server
  child.unref()

  return NextResponse.json({
    started: true,
    message: 'Browser is opening — complete the flow in the Chromium window.',
  })
}
