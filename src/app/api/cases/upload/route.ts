import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

const MAX_SIZE = 4 * 1024 * 1024 // 4 MB
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData() as unknown as globalThis.FormData
  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File exceeds 4 MB limit' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'File type not allowed. Accepted: jpeg, png, gif, webp, pdf, csv, xlsx' },
      { status: 400 },
    )
  }

  const blob = await put(`cases/${Date.now()}-${file.name}`, file, {
    access: 'public',
    contentType: file.type,
  })

  return NextResponse.json({
    url: blob.url,
    filename: file.name,
    contentType: file.type,
    size: file.size,
  })
}
