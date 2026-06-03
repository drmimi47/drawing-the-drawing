import { useEffect, useRef, useState } from 'react'
import { useDrawingStore } from '../../store/drawingStore'

/**
 * DOM text-entry for the Text tool. A borderless, transparent <textarea> placed at
 * the click location: Enter commits, Shift+Enter inserts a newline (paragraphs /
 * lists), Escape cancels, blur commits. The box auto-sizes to its content so what
 * you type previews exactly as the committed multi-line label. Clearing the text
 * deletes the label (when editing an existing one).
 */
export function TextEditor() {
  const pending = useDrawingStore((s) => s.pendingText)
  const commitText = useDrawingStore((s) => s.commitText)
  const cancelText = useDrawingStore((s) => s.cancelText)
  const strokeColor = useDrawingStore((s) => s.strokeColor)

  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const committedRef = useRef(false)

  // Grow the box to fit its content in both axes (white-space:pre, no wrapping —
  // lines break only where the user pressed Shift+Enter).
  const autosize = () => {
    const el = inputRef.current
    if (!el) return
    el.style.width = '0px'
    el.style.height = '0px'
    el.style.width = `${el.scrollWidth + 2}px`
    el.style.height = `${el.scrollHeight}px`
  }

  // Reset the field whenever a new editing session starts.
  useEffect(() => {
    if (pending) {
      setValue(pending.initial)
      committedRef.current = false
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (el) {
          el.focus()
          const len = el.value.length
          el.setSelectionRange(len, len)
        }
        autosize()
      })
    }
  }, [pending])

  if (!pending) return null

  const commit = () => {
    if (committedRef.current) return
    committedRef.current = true
    commitText(value)
  }

  return (
    <textarea
      ref={inputRef}
      className="text-editor"
      rows={1}
      wrap="off"
      spellCheck={false}
      style={{ left: pending.screenX, top: pending.screenY, color: strokeColor }}
      value={value}
      placeholder="add text"
      onChange={(e) => {
        setValue(e.target.value)
        autosize()
      }}
      onKeyDown={(e) => {
        // While editing, the textarea owns the keyboard: stop the event from reaching
        // window-level handlers (Space-to-pan, polyline finish, undo, etc.).
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          committedRef.current = true
          cancelText()
        }
        // Shift+Enter falls through to the textarea's default → inserts a newline.
      }}
      onBlur={commit}
    />
  )
}
