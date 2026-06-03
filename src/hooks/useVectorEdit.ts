import { useCallback, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'
import { SNAP_THRESHOLD_PX, type SnapPoint } from '../geometry/spatialIndex'
import { snapOrtho } from '../geometry/snapMath'
import { getEditTargets } from '../geometry/editTargets'

/** Pick radius for grabbing an anchor point, in screen pixels. */
const PICK_RADIUS_PX = 10

/**
 * Edit tool (Illustrator "direct selection" style). Press near an anchor point to
 * grab and drag it, OR press on a text label to reposition it. One undo step per
 * drag (snapshot on grab).
 *
 * WHAT is editable depends on the active pipeline layer (getEditTargets), so the
 * tool transforms the geometry that layer is about — and only on the active board
 * (it reads the live store; neighbor boards are read-only ghosts):
 *   • Lot Boundary layer → the boundary ring vertices.
 *   • Circulation layer  → the circulation centerline vertices.
 *   • other layers       → the planar-graph vertices.
 *
 * ALL anchors snap onto nearby geometry while dragging — a boundary or circulation
 * vertex can land exactly on the lot boundary, another centerline, or a graph vertex
 * so the pieces actually touch. The spatial index keys the boundary/circulation
 * vertices ('bnd:v<i>', 'circ:<pathId>:v<i>'), so the dragged anchor (and its own
 * incident edge midpoints) is excluded by id and never snaps to itself. Holding
 * Shift constrains the drag to a H/V axis from the grab origin (snap still wins).
 */

/** The spatial-index vertex id for a drag key (so nearest() can exclude self). */
function indexIdForKey(key: string): string {
  if (key.startsWith('bnd:')) return `bnd:v${key.slice(4)}`
  if (key.startsWith('circ:')) {
    const parts = key.split(':')
    return `circ:${parts[1]}:v${parts[2]}`
  }
  return key // graph vertex id
}
export function useVectorEdit() {
  const { camera } = useThree()
  const beginHistory = useDrawingStore((s) => s.beginHistory)
  const setVertexPositions = useDrawingStore((s) => s.setVertexPositions)
  const setBoundaryPoint = useDrawingStore((s) => s.setBoundaryPoint)
  const setCirculationPoint = useDrawingStore((s) => s.setCirculationPoint)
  const moveText = useDrawingStore((s) => s.moveText)

  // Key of the anchor being dragged (see getEditTargets for the key grammar).
  const draggingKeyRef = useRef<string | null>(null)
  // Anchor position at grab time — the origin for the Shift-ortho constraint.
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null)
  const draggingTextRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const [snap, setSnap] = useState<SnapPoint | null>(null)

  /** Apply a dragged anchor's new position to the right store slice by key. */
  const applyDrag = useCallback(
    (key: string, x: number, y: number) => {
      if (key.startsWith('bnd:')) {
        setBoundaryPoint(Number(key.slice(4)), x, y)
      } else if (key.startsWith('circ:')) {
        const parts = key.split(':')
        setCirculationPoint(parts[1], Number(parts[2]), x, y)
      } else {
        setVertexPositions({ [key]: { x, y } })
      }
    },
    [setBoundaryPoint, setCirculationPoint, setVertexPositions],
  )

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

      // 2) Layer-appropriate anchors (nearest within a screen radius).
      const radius = PICK_RADIUS_PX / zoom
      let bestDist = radius * radius
      let best: { key: string; x: number; y: number } | null = null
      const { points } = getEditTargets(store.activeLayer, store.graph, store.boundary, store.circulationPaths)
      for (const t of points) {
        const dx = t.x - px
        const dy = t.y - py
        const d = dx * dx + dy * dy
        if (d <= bestDist) {
          bestDist = d
          best = t
        }
      }
      if (!best) return

      ;(e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.nativeEvent.pointerId)
      draggingKeyRef.current = best.key
      dragOriginRef.current = { x: best.x, y: best.y }
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
      const key = draggingKeyRef.current
      if (!key) return
      const zoom = (camera as OrthographicCamera).zoom || 1
      let x = e.point.x
      let y = e.point.y
      // Snap onto nearby geometry (vertices/midpoints), excluding the dragged anchor
      // by its spatial-index id so it can't snap to itself — works for graph,
      // boundary, and circulation anchors alike.
      const store = useDrawingStore.getState()
      const sp = store.snappingEnabled
        ? store.spatialIndex.nearest(x, y, SNAP_THRESHOLD_PX / zoom, new Set([indexIdForKey(key)]))
        : null
      if (sp) {
        x = sp.x
        y = sp.y
      } else if (e.nativeEvent.shiftKey && dragOriginRef.current) {
        const o = snapOrtho(dragOriginRef.current, { x, y })
        x = o.x
        y = o.y
      }
      setSnap(sp)
      applyDrag(key, x, y)
    },
    [applyDrag, moveText, camera],
  )

  const onPointerUp = useCallback(() => {
    draggingKeyRef.current = null
    dragOriginRef.current = null
    draggingTextRef.current = null
    setSnap(null)
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp, snap }
}
