import { useCallback, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'
import { SNAP_THRESHOLD_PX, type SnapPoint } from '../geometry/spatialIndex'
import { snapOrtho } from '../geometry/snapMath'

/** Pick radius for grabbing an anchor point, in screen pixels. */
const PICK_RADIUS_PX = 10

/**
 * Edit tool (Illustrator "direct selection" style). Press near an anchor point
 * to grab and drag it (connected strokes update live), OR press on a text label
 * to reposition it. One undo step per drag (snapshot on grab).
 *
 * While dragging a vertex it snaps onto nearby vertices / edge midpoints (the
 * dragged vertex and its own edges are excluded so it can't snap to itself), and
 * the active snap target is surfaced for an on-canvas indicator. Holding Shift
 * constrains the drag to a horizontal/vertical axis from the grab origin (object
 * snap still wins when a target is in range, mirroring the polyline tool).
 */
export function useVectorEdit() {
  const { camera } = useThree()
  const beginHistory = useDrawingStore((s) => s.beginHistory)
  const setVertexPositions = useDrawingStore((s) => s.setVertexPositions)
  const moveText = useDrawingStore((s) => s.moveText)

  const draggingVertexRef = useRef<string | null>(null)
  // Vertex position at grab time — the anchor for Shift-ortho constraint.
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null)
  const draggingTextRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const [snap, setSnap] = useState<SnapPoint | null>(null)

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      const zoom = (camera as OrthographicCamera).zoom || 1
      const store = useDrawingStore.getState()
      const px = e.point.x
      const py = e.point.y

      // 1) Text labels (hit-test the rendered box; anchor is top-left, text goes
      //    right and downward on screen = -y in world).
      for (let i = store.textLabels.length - 1; i >= 0; i--) {
        const l = store.textLabels[i]
        const w = Math.max(8, l.text.length * l.size * 0.6) / zoom
        const h = (l.size * 1.3) / zoom
        if (px >= l.x && px <= l.x + w && py <= l.y && py >= l.y - h) {
          ;(e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.nativeEvent.pointerId)
          draggingTextRef.current = { id: l.id, dx: px - l.x, dy: py - l.y }
          beginHistory()
          return
        }
      }

      // 2) Graph vertices (nearest within a screen radius).
      const radius = PICK_RADIUS_PX / zoom
      const r2 = radius * radius
      let bestId: string | null = null
      let bestDist = r2
      for (const id in store.graph.vertices) {
        const v = store.graph.vertices[id]
        const dx = v.x - px
        const dy = v.y - py
        const d = dx * dx + dy * dy
        if (d <= bestDist) {
          bestDist = d
          bestId = id
        }
      }
      if (!bestId) return

      ;(e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.nativeEvent.pointerId)
      draggingVertexRef.current = bestId
      const gv = store.graph.vertices[bestId]
      dragOriginRef.current = { x: gv.x, y: gv.y }
      beginHistory()
    },
    [camera, beginHistory],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const text = draggingTextRef.current
      if (text) {
        moveText(text.id, e.point.x - text.dx, e.point.y - text.dy)
        return
      }
      const id = draggingVertexRef.current
      if (!id) return
      const zoom = (camera as OrthographicCamera).zoom || 1
      let x = e.point.x
      let y = e.point.y
      // Snap to nearby geometry, excluding the dragged vertex and its own edges.
      // Master snapping switch (Cluster 4): when off, skip the index query entirely
      // and ride raw pointer input (Shift-ortho still applies as an explicit lock).
      const store = useDrawingStore.getState()
      const sp = store.snappingEnabled
        ? store.spatialIndex.nearest(x, y, SNAP_THRESHOLD_PX / zoom, new Set([id]))
        : null
      if (sp) {
        x = sp.x
        y = sp.y
      } else if (e.nativeEvent.shiftKey && dragOriginRef.current) {
        // Object snap wins; otherwise Shift locks to an axis from the grab origin.
        const o = snapOrtho(dragOriginRef.current, { x, y })
        x = o.x
        y = o.y
      }
      setSnap(sp)
      setVertexPositions({ [id]: { x, y } })
    },
    [setVertexPositions, moveText, camera],
  )

  const onPointerUp = useCallback(() => {
    draggingVertexRef.current = null
    dragOriginRef.current = null
    draggingTextRef.current = null
    setSnap(null)
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp, snap }
}
