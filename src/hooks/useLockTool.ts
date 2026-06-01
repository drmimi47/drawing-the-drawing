import { useCallback, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useDrawingStore } from '../store/drawingStore'
import { DEFAULT_FEATHER_RADIUS, pointInPolygon } from '../geometry/locks'

/**
 * Lock-region tool (Cluster H, LASSO_LOCK). Draw a freehand polygon to add a
 * feathered lock region. A click (no drag) inside an existing lock removes it.
 *
 * Exposes a live world-space `outline` for the marching-ants overlay.
 */

const MIN_STEP_SQ = 4

export function useLockTool() {
  const [outline, setOutline] = useState<{ points: { x: number; y: number }[] } | null>(null)
  const activeRef = useRef(false)
  const ptsRef = useRef<{ x: number; y: number }[]>([])
  const startRef = useRef({ x: 0, y: 0 })

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return
    ;(e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.nativeEvent.pointerId)
    activeRef.current = true
    const p = { x: e.point.x, y: e.point.y }
    startRef.current = p
    ptsRef.current = [p]
    setOutline({ points: [p] })
  }, [])

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!activeRef.current) return
    const p = { x: e.point.x, y: e.point.y }
    const last = ptsRef.current[ptsRef.current.length - 1]
    const dx = p.x - last.x
    const dy = p.y - last.y
    if (dx * dx + dy * dy >= MIN_STEP_SQ) {
      ptsRef.current.push(p)
      setOutline({ points: [...ptsRef.current] })
    }
  }, [])

  const onPointerUp = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    const pts = ptsRef.current
    setOutline(null)

    const store = useDrawingStore.getState()
    const moved =
      Math.hypot(
        pts[pts.length - 1].x - startRef.current.x,
        pts[pts.length - 1].y - startRef.current.y,
      ) > 4

    if (!moved || pts.length < 3) {
      // Treat as a click: remove a lock under the cursor, if any.
      const hit = store.lockPolygons.find((l) => pointInPolygon(startRef.current.x, startRef.current.y, l.points))
      if (hit) store.removeLock(hit.id)
      return
    }

    store.addLockRegion(pts, DEFAULT_FEATHER_RADIUS)
  }, [])

  return { outline, onPointerDown, onPointerMove, onPointerUp }
}
