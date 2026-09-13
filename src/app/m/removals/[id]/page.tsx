'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft, Camera, ImageIcon, Loader2, X, CheckCircle2, AlertCircle } from 'lucide-react'

interface CaseImage { url: string; filename: string; contentType: string; size: number }
interface RemovalCase {
  id: string; caseNumber: number; trackingNumber: string | null
  sellerSku: string | null; fnsku: string | null; lpnNumber: string | null; productTitle: string | null
  status: string; images: CaseImage[] | unknown
}

const STATUS_LABEL: Record<string, string> = {
  CASE_NOT_CREATED: 'Not Created', CASE_CREATED: 'Case Created',
  REIMBURSEMENT_DENIED: 'Denied', RESOLVED_REIMBURSED: 'Reimbursed',
}

/** Downscale + JPEG-compress a photo so it lands under Vercel Blob's 4 MB limit
 *  (iPhone captures are routinely larger) and normalizes HEIC/PNG to JPEG. */
async function compressToJpeg(file: File, maxDim = 2000, maxBytes = 3.5 * 1024 * 1024): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  let bitmap: ImageBitmap
  try {
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
    catch { bitmap = await createImageBitmap(file) }
  } catch { return file } // browser can't decode (rare) → send original
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) { bitmap.close?.(); return file }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  let quality = 0.85
  let blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality))
  while (blob && blob.size > maxBytes && quality > 0.4) {
    quality -= 0.15
    blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality))
  }
  if (!blob) return file
  const name = (file.name.replace(/\.[^.]+$/, '') || `photo-${Date.now()}`) + '.jpg'
  return new File([blob], name, { type: 'image/jpeg' })
}

export default function MobileRemovalDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [rc, setRc] = useState<RemovalCase | null>(null)
  const [images, setImages] = useState<CaseImage[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [okFlash, setOkFlash] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/removal-cases/${id}`)
      const d = await res.json()
      if (res.ok) { setRc(d); setImages(Array.isArray(d.images) ? d.images : []) }
      else setError(d.error ?? 'Failed to load case')
    } catch { setError('Failed to load case') } finally { setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    setError(null)
    setUploading({ done: 0, total: files.length })
    const uploaded: CaseImage[] = []
    for (let i = 0; i < files.length; i++) {
      try {
        const f = await compressToJpeg(files[i])
        const fd = new FormData()
        fd.append('file', f)
        const res = await fetch('/api/cases/upload', { method: 'POST', body: fd })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Upload failed')
        uploaded.push(d)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed')
      }
      setUploading({ done: i + 1, total: files.length })
    }
    if (uploaded.length) {
      const merged = [...images, ...uploaded]
      try {
        const res = await fetch(`/api/removal-cases/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: merged }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save photos')
        setImages(merged)
        setOkFlash(true); setTimeout(() => setOkFlash(false), 2000)
      } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save photos') }
    }
    setUploading(null)
  }

  async function removeImage(url: string) {
    if (!confirm('Remove this photo from the case?')) return
    const next = images.filter(im => im.url !== url)
    try {
      const res = await fetch(`/api/removal-cases/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: next }),
      })
      if (!res.ok) throw new Error()
      setImages(next)
    } catch { setError('Failed to remove photo') }
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <header className="sticky top-0 z-10 bg-amazon-blue text-white px-2 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-1 py-2.5">
          <button onClick={() => router.push('/m/removals')} className="p-1.5 -ml-1 rounded-lg active:bg-white/10"><ChevronLeft size={22} /></button>
          <div className="min-w-0 flex-1">
            {loading ? <span className="text-sm">Loading…</span> : rc ? (
              <>
                <div className="text-[11px] font-semibold text-white/70 truncate">REMOVALCASE-{rc.caseNumber}</div>
                <div className="truncate leading-tight">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-white/60 mr-1 align-middle">LPN</span>
                  <span className="font-mono font-extrabold text-lg text-white align-middle">{rc.lpnNumber || '—'}</span>
                </div>
                <div className="text-[11px] text-white/70 truncate">{rc.sellerSku ?? '—'} · {STATUS_LABEL[rc.status] ?? rc.status}</div>
              </>
            ) : <span className="text-sm">Case not found</span>}
          </div>
        </div>
      </header>

      <main className="flex-1 p-3 pb-40">
        {rc && (
          <div className="bg-white rounded-xl p-3 shadow-sm text-[13px] space-y-1 mb-3">
            {rc.productTitle && <div className="text-gray-800 font-medium">{rc.productTitle}</div>}
            <div className="text-gray-500">Tracking: <span className="font-mono text-gray-700">{rc.trackingNumber ?? '—'}</span></div>
            {rc.fnsku && <div className="text-gray-500">FNSKU: <span className="font-mono text-gray-700">{rc.fnsku}</span></div>}
          </div>
        )}

        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Photos ({images.length})</h2>
          {okFlash && <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-semibold"><CheckCircle2 size={13} /> Saved</span>}
        </div>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[12px] text-red-700">
            <AlertCircle size={15} className="shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {images.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm rounded-xl border-2 border-dashed border-gray-200">No photos yet</div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {images.map((im, i) => (
              <div key={im.url + i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.url} alt={im.filename} className="w-full h-full object-cover" />
                <button onClick={() => removeImage(im.url)} className="absolute top-1 right-1 bg-black/55 text-white rounded-full p-1 active:bg-black/70"><X size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Hidden inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
      <input ref={libraryRef} type="file" accept="image/*" multiple hidden onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />

      {/* Sticky action bar */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] flex gap-2">
        {uploading ? (
          <div className="flex-1 h-12 rounded-xl bg-amazon-blue/10 text-amazon-blue font-semibold flex items-center justify-center gap-2 text-sm">
            <Loader2 size={18} className="animate-spin" /> Uploading {uploading.done}/{uploading.total}…
          </div>
        ) : (
          <>
            <button onClick={() => cameraRef.current?.click()} disabled={!rc}
              className="flex-1 h-12 rounded-xl bg-amazon-blue text-white font-semibold flex items-center justify-center gap-2 text-sm active:bg-blue-700 disabled:opacity-50">
              <Camera size={18} /> Take Photo
            </button>
            <button onClick={() => libraryRef.current?.click()} disabled={!rc}
              className="h-12 px-4 rounded-xl border border-gray-300 text-gray-700 font-semibold flex items-center justify-center gap-2 text-sm active:bg-gray-50 disabled:opacity-50">
              <ImageIcon size={18} /> Library
            </button>
          </>
        )}
      </div>
    </div>
  )
}
