import { useCallback, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useDrawingStore } from '../store/drawingStore'
import { DEFAULT_FEATHER_RADIUS, pointInPolygon } from '../geometry/locks'

/**
 * Lock-region tool (Cluster H, LASSO_LOCK). Drag a rectangle (like the Marquee
 * Select tool) to add a lock region. A click (no drag) inside an existing lock
 * removes it.
 *
 * The committed region is still a polygon, so the influence/falloff rule and
 * multi-region unioning are unchanged — only the authoring gesture is a rect.
 *
 * Exposes a live world-space `outline` for the marching-ants overlay.
 */

const MIN_DRAG = 4 // world units before a drag counts as a region (vs. a click)

function rectCorners(ax: number, ay: number, bx: number, by: number) {
  return [
    { x: ax, y: ay },
    { x: bx, y: ay },
    { x: bx, y: by },
    { x: ax, y: by },
  ]
}

export function useLockTool() {
  const [outline, setOutline] = useState<{ points: { x: number; y: number }[] } | null>(null)
  const activeRef = useRef(false)
  const startRef = useRef({ x: 0, y: 0 })
  const endRef = useRef({ x: 0, y: 0 })

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return
    ;(e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.nativeEvent.pointerId)
    activeRef.current = true
    const p = { x: e.point.x, y: e.point.y }
    startRef.current = p
    endRef.current = p
    // On the Rooms layer the Lock tool locks individual ROOMS (click interior) — no rect outline.
    if (useDrawingStore.getState().activeLayer !== 'ROOMS') setOutline({ points: rectCorners(p.x, p.y, p.x, p.y) })
  }, [])

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!activeRef.current) return
    const p = { x: e.point.x, y: e.point.y }
    endRef.current = p
    if (useDrawingStore.getState().activeLayer !== 'ROOMS') {
      setOutline({ points: rectCorners(startRef.current.x, startRef.current.y, p.x, p.y) })
    }
  }, [])

  const onPointerUp = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    setOutline(null)

    const store = useDrawingStore.getState()
    const { x: sx, y: sy } = startRef.current
    const { x: ex, y: ey } = endRef.current

    // Rooms layer: click a room's interior to toggle its lock (shields it from Intent "Adjust").
    if (store.activeLayer === 'ROOMS') {
      store.toggleRoomLockAt(sx, sy)
      return
    }

    const moved = Math.hypot(ex - sx, ey - sy) > MIN_DRAG
    if (!moved) {
      // Treat as a click: remove a lock under the cursor, if any.
      const hit = store.lockPolygons.find((l) => pointInPolygon(sx, sy, l.points))
      if (hit) store.removeLock(hit.id)
      return
    }

    const minX = Math.min(sx, ex)
    const maxX = Math.max(sx, ex)
    const minY = Math.min(sy, ey)
    const maxY = Math.max(sy, ey)
    store.addLockRegion(rectCorners(minX, minY, maxX, maxY), DEFAULT_FEATHER_RADIUS)
  }, [])

  return { outline, onPointerDown, onPointerMove, onPointerUp }
}
