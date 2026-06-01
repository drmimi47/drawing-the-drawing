import { useEffect, useRef, useState } from 'react'
import { useDrawingStore } from '../../store/drawingStore'

/**
 * DOM text-entry box for the Text tool. Appears at the click location; commits on
 * Enter or blur, cancels on Escape. Clearing the text deletes the label (when
 * editing an existing one).
 */
export function TextEditor() {
  const pending = useDrawingStore((s) => s.pendingText)
  const commitText = useDrawingStore((s) => s.commitText)
  const cancelText = useDrawingStore((s) => s.cancelText)

  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(false)

  // Reset the field whenever a new editing session starts.
  useEffect(() => {
    if (pending) {
      setValue(pending.initial)
      committedRef.current = false
      // Focus after mount.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [pending])

  if (!pending) return null

  const commit = () => {
    if (committedRef.current) return
    committedRef.current = true
    commitText(value)
  }

  return (
    <input
      ref={inputRef}
      className="text-editor"
      style={{ left: pending.screenX, top: pending.screenY }}
      value={value}
      placeholder="Type…"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          committedRef.current = true
          cancelText()
        }
      }}
      onBlur={commit}
    />
  )
}
