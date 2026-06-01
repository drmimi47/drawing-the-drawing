import { useCallback } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'

/** Click radius (screen px) for grabbing an existing pin marker to remove it. */
const MARKER_PICK_PX = 12

/**
 * Intent-pin placement (Cluster H, H5). Flow:
 *   1. click an empty spot → drops a center and opens the type popup (phase 'type')
 *   2. choose a type in the popup → phase 'radius'
 *   3. move the pointer to size the field; click to place it
 * Clicking an existing pin marker (when idle) removes it. Esc cancels (popup).
 */
export function useIntentPinTool() {
  const { camera } = useThree()

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      const store = useDrawingStore.getState()
      const pending = store.pendingPin

      if (pending) {
        // A click during radius sizing places the pin; during type choice, ignore.
        if (pending.phase === 'radius') store.commitPin()
        return
      }

      // Idle: remove a pin if we clicked on its marker, else begin a new one.
      const zoom = (camera as OrthographicCamera).zoom || 1
      const pickR = MARKER_PICK_PX / zoom
      const pickR2 = pickR * pickR
      const hit = store.intentPins.find((p) => {
        const dx = p.x - e.point.x
        const dy = p.y - e.point.y
        return dx * dx + dy * dy <= pickR2
      })
      if (hit) {
        store.removeIntentPin(hit.id)
        return
      }

      store.beginPin(e.point.x, e.point.y, e.nativeEvent.clientX, e.nativeEvent.clientY)
    },
    [camera],
  )

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const store = useDrawingStore.getState()
    const pending = store.pendingPin
    if (!pending || pending.phase !== 'radius') return
    const r = Math.hypot(e.point.x - pending.x, e.point.y - pending.y)
    store.setPinRadius(Math.max(8, r))
  }, [])

  const onPointerUp = useCallback(() => {}, [])

  return { onPointerDown, onPointerMove, onPointerUp }
}
