import { useEffect, useState } from 'react'

/**
 * Controlled grid cells (document_int.txt §4.1 / §4.3). Edits commit on blur or Enter (never
 * per-keystroke, so the Stage-4 slicing cascade isn't run mid-typing); Esc reverts. A `validate`
 * hook can reject a value — the cell falls back to the last good value and reports the reason.
 */

export interface ValidateResult {
  ok: boolean
  value?: number
  msg?: string
}

export function NumberCell({
  value,
  onCommit,
  validate,
  onReject,
  onClear,
  placeholder,
  className,
  ariaLabel,
}: {
  value: number | null | undefined
  onCommit: (value: number) => void
  validate: (raw: string) => ValidateResult
  onReject?: (msg: string) => void
  /** If provided, emptying the cell commits a "cleared" value (e.g. remove a target). */
  onClear?: () => void
  placeholder?: string
  className?: string
  ariaLabel?: string
}) {
  const asText = value == null ? '' : String(value)
  const [draft, setDraft] = useState(asText)
  // Re-sync when the store value changes from elsewhere (downstream binding).
  useEffect(() => setDraft(asText), [asText])

  const commit = () => {
    if (draft === asText) return
    if (draft.trim() === '' && onClear) {
      onClear()
      return
    }
    const res = validate(draft)
    if (!res.ok || res.value == null) {
      setDraft(asText) // fall back to the last valid value
      if (res.msg) onReject?.(res.msg)
      return
    }
    onCommit(res.value)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      className={`ps-cell-input${className ? ' ' + className : ''}`}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setDraft(asText)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export function TextCell({
  value,
  onCommit,
  ariaLabel,
  placeholder,
}: {
  value: string
  onCommit: (value: string) => void
  ariaLabel?: string
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      type="text"
      className="ps-cell-input"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
