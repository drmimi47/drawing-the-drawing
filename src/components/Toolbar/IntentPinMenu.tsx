import { useEffect } from 'react'
import { useDrawingStore } from '../../store/drawingStore'
import { INTENT_META, type IntentType } from '../../types/geometry'

/**
 * Intent-pin type popup (Cluster H, H5). After dropping a pin center, a menu at
 * the click location asks which intent type. Choosing one switches the pin into
 * radius-sizing mode (the user then moves the pointer to size it and clicks to
 * place). Esc cancels.
 */

const TYPES = Object.keys(INTENT_META) as IntentType[]

export function IntentPinMenu() {
  const pending = useDrawingStore((s) => s.pendingPin)
  const setPinType = useDrawingStore((s) => s.setPinType)
  const cancelPin = useDrawingStore((s) => s.cancelPin)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useDrawingStore.getState().pendingPin) {
        e.preventDefault()
        cancelPin()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelPin])

  if (!pending) return null

  if (pending.phase === 'type') {
    return (
      <div
        className="context-menu"
        style={{ left: pending.screenX, top: pending.screenY }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="context-menu-label">Intent type</div>
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className="context-menu-item"
            onClick={() => setPinType(t)}
          >
            <span className="intent-swatch" style={{ background: INTENT_META[t].color }} />
            {INTENT_META[t].label}
          </button>
        ))}
        <button type="button" className="context-menu-item context-menu-cancel" onClick={cancelPin}>
          Cancel
        </button>
      </div>
    )
  }

  // Radius-sizing hint.
  return (
    <div className="size-hint" style={{ left: pending.screenX, top: pending.screenY }}>
      Move to size · click to place · Esc to cancel
    </div>
  )
}
