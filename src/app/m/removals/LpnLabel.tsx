// LPN shown as a little warehouse barcode sticker: a yellow "LPN" tab, a strip of
// barcode bars, and the number as the human-readable line beneath. Purely cosmetic
// (not a scannable barcode) — "barcode vibes".
const BARCODE =
  'repeating-linear-gradient(90deg,#111 0 1px,transparent 1px 2px,#111 2px 4px,transparent 4px 5px,#111 5px 6px,transparent 6px 8px,#111 8px 11px,transparent 11px 12px,#111 12px 13px,transparent 13px 15px)'

export default function LpnLabel({ value, size = 'sm' }: { value: string | null; size?: 'sm' | 'lg' }) {
  const barH = size === 'lg' ? 'h-5' : 'h-3.5'
  const numText = size === 'lg' ? 'text-base' : 'text-[13px]'
  return (
    <div className="inline-flex items-stretch max-w-full -rotate-1 rounded-[4px] overflow-hidden border border-black/30 shadow-sm bg-white">
      <span className="flex items-center bg-yellow-300 text-gray-900 text-[9px] font-extrabold uppercase tracking-widest px-1.5 border-r border-black/30">LPN</span>
      <span className="flex flex-col justify-center min-w-0 px-2 py-0.5">
        <span className={`${barH} w-full`} style={{ backgroundImage: BARCODE, backgroundRepeat: 'repeat-x' }} aria-hidden />
        <span className={`font-mono font-bold ${numText} text-gray-900 tracking-[0.15em] leading-tight truncate`}>{value || '—'}</span>
      </span>
    </div>
  )
}
