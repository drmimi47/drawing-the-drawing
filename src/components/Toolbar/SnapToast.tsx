import { useEffect, useRef, useState } from 'react'
import { Magnet } from 'lucide-react'
import { useDrawingStore } from '../../store/drawingStore'
import './SnapToast.css'

/**
 * Transient confirmation toast for the master snapping toggle (Cluster 4).
 *
 * Shows briefly whenever `snappingEnabled` flips — so the F3 / Ctrl+G shortcut
 * gives clear, mid-session feedback without the user having to glance at the
 * tool rail. Skips the initial mount (only reacts to genuine changes).
 */
const TOAST_MS = 1100

export function SnapToast() {
  const enabled = useDrawingStore((s) => s.snappingEnabled)
  const [visible, setVisible] = useState(false)
  // Seed with the value at first render so mount (and StrictMode's dev double-mount,
  // which would defeat a plain "skip first run" flag) never shows the toast — it
  // only appears on a genuine change of `enabled`.
  const prev = useRef(enabled)

  useEffect(() => {
    if (prev.current === enabled) return
    prev.current = enabled
    setVisible(true)
    const t = setTimeout(() => setVisible(false), TOAST_MS)
    return () => clearTimeout(t)
  }, [enabled])

  if (!visible) return null

  return (
    <div className={`snap-toast${enabled ? '' : ' snap-toast--off'}`} role="status" aria-live="polite">
      <Magnet size={16} strokeWidth={2} />
      <span>{enabled ? 'Snapping On' : 'Snapping Off'}</span>
    </div>
  )
}
