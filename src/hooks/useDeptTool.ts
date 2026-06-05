import { useCallback } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'
import { pointInPolygon } from '../geometry/locks'

/** Click radius (screen px) for grabbing an existing department marker to remove it. */
const MARKER_PICK_PX = 12

/**
 * Department zone placement (restructure_v1 Stage 3.1). Like the intent-pin tool but
 * the center may only land INSIDE the closed lot boundary — departments are a program
 * of the lot, so a click outside the lot is ignored. Flow:
 *   1. click an empty spot inside the lot → drops a center, opens the program-type popup
 *   2. choose a type in the popup → radius-sizing mode
 *   3. move the pointer to size the field; click again to place it
 * Clicking an existing department marker (when idle) removes it. Esc cancels (popup).
 */
export function useDeptTool() {
  const { camera } = useThree()

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      const store = useDrawingStore.getState()

      if (store.pendingDept) {
        // A click during radius sizing places the zone; during type choice, ignore it
        // (the popup handles the choice).
        if (store.pendingDept.phase === 'radius') store.commitDept()
        return
      }

      // Idle: remove a department if we clicked its marker, else begin a new one.
      const zoom = (camera as OrthographicCamera).zoom || 1
      const pickR = MARKER_PICK_PX / zoom
      const pickR2 = pickR * pickR
      const hit = store.departments.find((d) => {
        const dx = d.x - e.point.x
        const dy = d.y - e.point.y
        return dx * dx + dy * dy <= pickR2
      })
      if (hit) {
        store.removeDepartment(hit.id)
        return
      }

      // Gate placement to inside the closed lot boundary.
      const b = store.boundary
      if (!b || b.isClosed === false || b.ring.length < 3) return
      if (!pointInPolygon(e.point.x, e.point.y, b.ring)) return

      store.beginDept(e.point.x, e.point.y, e.nativeEvent.clientX, e.nativeEvent.clientY)
    },
    [camera],
  )

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const store = useDrawingStore.getState()
    const pending = store.pendingDept
    if (!pending || pending.phase !== 'radius') return
    const r = Math.hypot(e.point.x - pending.x, e.point.y - pending.y)
    store.setDeptRadius(Math.max(12, r))
  }, [])

  const onPointerUp = useCallback(() => {}, [])

  return { onPointerDown, onPointerMove, onPointerUp }
}
