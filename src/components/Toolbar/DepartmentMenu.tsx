import { useEffect } from 'react'
import { useDrawingStore } from '../../store/drawingStore'
import { DEPARTMENT_TYPES, DEPARTMENT_META } from '../../types/geometry'

/**
 * Department program-type popup (mirrors the intent-pin type menu). After dropping a
 * department center, a menu at the click location asks which program it is. Choosing one
 * sets the type (and its color/name) and switches into radius-sizing mode (move the pointer
 * to size, click to place). Esc cancels.
 */
export function DepartmentMenu() {
  const pending = useDrawingStore((s) => s.pendingDept)
  const setDeptType = useDrawingStore((s) => s.setDeptType)
  const cancelDept = useDrawingStore((s) => s.cancelDept)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useDrawingStore.getState().pendingDept) {
        e.preventDefault()
        cancelDept()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelDept])

  if (!pending) return null

  if (pending.phase === 'type') {
    return (
      <div
        className="context-menu"
        style={{ left: pending.screenX, top: pending.screenY }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="context-menu-label">Department</div>
        {DEPARTMENT_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className="context-menu-item"
            onClick={() => setDeptType(t)}
          >
            <span className="intent-swatch" style={{ background: DEPARTMENT_META[t].color }} />
            {DEPARTMENT_META[t].label}
          </button>
        ))}
        <button type="button" className="context-menu-item context-menu-cancel" onClick={cancelDept}>
          Cancel
        </button>
      </div>
    )
  }

  // Radius-sizing hint.
  return (
    <div className="size-hint" style={{ left: pending.screenX, top: pending.screenY }}>
      Move to size · click to place
    </div>
  )
}
