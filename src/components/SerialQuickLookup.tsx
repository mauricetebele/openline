'use client'
import { useState } from 'react'
import { Barcode } from 'lucide-react'
import { clsx } from 'clsx'
import SNLookupModal from './SNLookupModal'

export default function SerialQuickLookup({ mobile }: { mobile?: boolean }) {
  const [query, setQuery] = useState('')
  const [showModal, setShowModal] = useState(false)

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (query.trim()) setShowModal(true)
    }
  }

  function handleClose() {
    setShowModal(false)
    setQuery('')
  }

  return (
    <>
      <div className={clsx('relative', mobile ? 'w-full' : 'w-56')}>
        <div className={clsx(
          'flex items-center gap-2 rounded-md border transition-all',
          mobile
            ? 'bg-gray-800 border-white/10 px-3 py-2'
            : 'bg-gray-800/60 border-white/[0.15] hover:border-white/25 focus-within:border-amazon-orange/50 focus-within:bg-gray-800/80 px-2.5 py-1.5',
        )}>
          <Barcode size={14} className="text-gray-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Serial # lookup"
            className="bg-transparent text-sm text-white placeholder:text-gray-400 outline-none w-full"
          />
        </div>
      </div>

      {showModal && (
        <SNLookupModal onClose={handleClose} initialQuery={query.trim()} />
      )}
    </>
  )
}
