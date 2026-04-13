'use client'
import { useEffect, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, List, ListOrdered, Send } from 'lucide-react'

interface Note {
  id: string
  body: string
  createdAt: string
}

function ToolbarButton({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-purple-100 text-purple-700'
          : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  )
}

export default function ClientNoteEditor({ readOnly, userId }: { readOnly?: boolean; userId?: string }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const fetchNotes = useCallback(async () => {
    try {
      const url = userId
        ? `/api/admin/users/notes?userId=${userId}`
        : '/api/client/notes'
      const res = await fetch(url)
      if (res.ok) setNotes(await res.json())
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Write a note or request...' }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[80px] px-3 py-2',
      },
    },
  })

  async function handleSubmit() {
    if (!editor || editor.isEmpty) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/client/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: editor.getHTML() }),
      })
      if (res.ok) {
        editor.commands.clearContent()
        fetchNotes()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-purple-500" />
        Notes &amp; Requests
      </h2>

      {/* Editor (hidden in read-only / admin view) */}
      {!readOnly && editor && (
        <div className="card mb-4">
          <div className="flex items-center gap-0.5 px-2 py-1.5 border-b bg-gray-50 rounded-t-xl">
            <ToolbarButton
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="Bold"
            >
              <Bold size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="Italic"
            >
              <Italic size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title="Bullet List"
            >
              <List size={14} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              title="Ordered List"
            >
              <ListOrdered size={14} />
            </ToolbarButton>
            <div className="flex-1" />
            <button
              onClick={handleSubmit}
              disabled={submitting || editor.isEmpty}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={12} />
              {submitting ? 'Sending...' : 'Post'}
            </button>
          </div>
          <EditorContent editor={editor} />
        </div>
      )}

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {loading ? (
          <p className="text-xs text-gray-400 text-center py-4">Loading notes...</p>
        ) : notes.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">No notes yet</p>
        ) : (
          notes.map(note => (
            <div key={note.id} className="card p-3">
              <div
                className="prose prose-sm max-w-none text-gray-700 [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1"
                dangerouslySetInnerHTML={{ __html: note.body }}
              />
              <p className="text-[10px] text-gray-400 mt-2">
                {new Date(note.createdAt).toLocaleString()}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
