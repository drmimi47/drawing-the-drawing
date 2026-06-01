import { useCallback, useEffect, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'
import type { SamplePoint } from '../types/geometry'
import { SNAP_THRESHOLD_PX, type SnapPoint } from '../geometry/spatialIndex'

/**
 * Polyline tool (next to Draw). Click to drop straight-segment vertices; the
 * segment to the cursor previews live. Finish by double-clicking, pressing
 * Enter, or clicking near the first vertex (to close). Esc cancels. Committed as
 * a `straight` stroke so corners stay sharp (no Catmull-Rom smoothing).
 *
 * Snapping: the cursor is continuously tested against the spatial index of
 * existing vertices + edge midpoints. A target within SNAP_THRESHOLD_PX locks the
 * cursor exactly onto it (CAD object-snap) and surfaces an indicator. Object snap
 * takes priority over Shift-ortho — snapping to a real point is the stronger
 * intent.
 *
 * Holding Shift (when nothing is snapped) constrains the segment to an orthogonal
 * (H/V) axis. The preview reacts immediately to Shift being pressed or released —
 * even with the pointer stationary — because the raw cursor is stored and the
 * constraint is derived from the live `isShiftPressed` state. Pointer moves are
 * coalesced into one update per frame via requestAnimationFrame.
 */

const CLOSE_DIST = 10 // world units near the first vertex counts as "close"

/** Snap a point to a horizontal/vertical line through the anchor (Shift). */
function snapOrtho(anchor: { x: number; y: number }, p: { x: number; y: number }) {
  const dx = p.x - anchor.x
  const dy = p.y - anchor.y
  return Math.abs(dx) >= Math.abs(dy) ? { x: p.x, y: anchor.y } : { x: anchor.x, y: p.y }
}

export function usePolyline() {
  const { camera } = useThree()
  const baseWidth = useDrawingStore((s) => s.baseWidth)
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const commitStroke = useDrawingStore((s) => s.commitStroke)

  const [points, setPoints] = useState<{ x: number; y: number }[]>([])
  // Raw (un-snapped) cursor; ortho/snap are applied at render time.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  // Active snap target under the cursor (drives both the cursor lock + indicator).
  const [snap, setSnap] = useState<SnapPoint | null>(null)
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const pointsRef = useRef<{ x: number; y: number }[]>([])

  // Coalesce pointer moves into one cursor+snap update per animation frame.
  const cursorRef = useRef<{ x: number; y: number } | null>(null)
  const snapRef = useRef<SnapPoint | null>(null)
  const rafRef = useRef(0)
  const flushCursor = useCallback(() => {
    rafRef.current = 0
    setCursor(cursorRef.current)
    setSnap(snapRef.current)
  }, [])
  const scheduleCursor = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flushCursor)
  }, [flushCursor])

  const reset = useCallback(() => {
    pointsRef.current = []
    setPoints([])
    setCursor(null)
    setSnap(null)
    cursorRef.current = null
    snapRef.current = null
  }, [])

  const finish = useCallback(() => {
    const pts = pointsRef.current
    if (pts.length >= 2) {
      const half = baseWidth / 2
      const sample: SamplePoint[] = pts.map((p) => ({ x: p.x, y: p.y, w: half }))
      commitStroke(sample, strokeColor, undefined, true)
    }
    reset()
  }, [baseWidth, strokeColor, commitStroke, reset])

  const cancel = useCallback(() => reset(), [reset])

  // Dual event listening: keys drive both control flow and the Shift snap state.
  // Toggling Shift updates isShiftPressed, which re-renders the preview from the
  // current cursor immediately — no pointer move required.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(true)
        return
      }
      if (pointsRef.current.length === 0) return
      if (e.key === 'Enter') {
        e.preventDefault()
        finish()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [finish, cancel])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      const pts = pointsRef.current
      const zoom = (camera as OrthographicCamera).zoom || 1
      let p = { x: e.point.x, y: e.point.y }
      // Object snap (existing vertex/midpoint) wins; else Shift-ortho off the
      // previous vertex.
      const sp = useDrawingStore.getState().spatialIndex.nearest(p.x, p.y, SNAP_THRESHOLD_PX / zoom)
      if (sp) p = { x: sp.x, y: sp.y }
      else if (e.nativeEvent.shiftKey && pts.length > 0) p = snapOrtho(pts[pts.length - 1], p)
      // Click near the first vertex closes the polyline.
      if (pts.length >= 2 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= CLOSE_DIST) {
        pointsRef.current = [...pts, { ...pts[0] }]
        finish()
        return
      }
      pointsRef.current = [...pts, p]
      setPoints(pointsRef.current)
    },
    [finish, camera],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const zoom = (camera as OrthographicCamera).zoom || 1
      const raw = { x: e.point.x, y: e.point.y }
      // Probe for a snap target so the indicator shows on hover (even before the
      // first vertex is placed).
      snapRef.current = useDrawingStore.getState().spatialIndex.nearest(raw.x, raw.y, SNAP_THRESHOLD_PX / zoom)
      cursorRef.current = raw
      scheduleCursor()
    },
    [scheduleCursor, camera],
  )

  const onPointerUp = useCallback(() => {}, [])
  const onDoubleClick = useCallback(() => finish(), [finish])

  // Live preview = committed vertices + the rubber-band point to the cursor.
  // Effective cursor: snap target wins, else Shift-ortho off the last vertex,
  // else the raw cursor.
  const half = baseWidth / 2
  const last = points[points.length - 1]
  let effCursor = cursor
  if (cursor) {
    if (snap) effCursor = { x: snap.x, y: snap.y }
    else if (isShiftPressed && last) effCursor = snapOrtho(last, cursor)
  }
  const rawPts = effCursor && points.length > 0 ? [...points, effCursor] : points
  const preview: SamplePoint[] = rawPts.map((p) => ({ x: p.x, y: p.y, w: half }))

  return { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, preview, snap }
}
