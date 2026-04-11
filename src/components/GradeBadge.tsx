'use client'

/**
 * Cute magnifying-glass–shaped grade badge.
 * Shows just the grade letter (e.g. "A") inside a circular "lens"
 * with a small diagonal handle — implying "inspected grade".
 */
export default function GradeBadge({ grade, size = 'sm' }: { grade: string; size?: 'sm' | 'xs' }) {
  const letter = grade.replace(/^Grade\s*/i, '').trim()
  const sm = size === 'sm'

  return (
    <span className="inline-flex items-center" title={`Grade ${letter}`}>
      <span
        className={[
          'relative inline-flex items-center justify-center rounded-full',
          'bg-purple-100 border-[1.5px] border-purple-400',
          'font-extrabold text-purple-700 leading-none',
          sm ? 'w-[20px] h-[20px] text-[10px]' : 'w-[16px] h-[16px] text-[8px]',
        ].join(' ')}
      >
        {letter}
        {/* magnifying-glass handle */}
        <span
          className={[
            'absolute bg-purple-400 rounded-full rotate-[45deg]',
            sm ? 'w-[7px] h-[2px] -bottom-[2px] -right-[2px]' : 'w-[5px] h-[1.5px] -bottom-[1.5px] -right-[1.5px]',
          ].join(' ')}
        />
      </span>
    </span>
  )
}
