import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useDrawingStore } from '../store/drawingStore'
import type { SamplePoint } from '../types/geometry'

/**
 * Polyline tool (next to Draw). Click to drop straight-segment vertices; the
 * segment to the cursor previews live. Finish by double-clicking, pressing
 * Enter, or clicking near the first vertex (to close). Esc cancels. Committed as
 * a `straight` stroke so corners stay sharp (no Catmull-Rom smoothing).
 */

const CLOSE_DIST = 10 // world units near the first vertex counts as "close"

export function usePolyline() {
  const baseWidth = useDrawingStore((s) => s.baseWidth)
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const commitStroke = useDrawingStore((s) => s.commitStroke)

  const [points, setPoints] = useState<{ x: number; y: number }[]>([])
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const pointsRef = useRef<{ x: number; y: number }[]>([])

  const finish = useCallback(() => {
    const pts = pointsRef.current
    if (pts.length >= 2) {
      const half = baseWidth / 2
      const sample: SamplePoint[] = pts.map((p) => ({ x: p.x, y: p.y, w: half }))
      commitStroke(sample, strokeColor, undefined, true)
    }
    pointsRef.current = []
    setPoints([])
    setCursor(null)
  }, [baseWidth, strokeColor, commitStroke])

  const cancel = useCallback(() => {
    pointsRef.current = []
    setPoints([])
    setCursor(null)
  }, [])

  // Enter finishes, Esc cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pointsRef.current.length === 0) return
      if (e.key === 'Enter') {
        e.preventDefault()
        finish()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finish, cancel])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      const p = { x: e.point.x, y: e.point.y }
      const pts = pointsRef.current
      // Click near the first vertex closes the polyline.
      if (pts.length >= 2 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= CLOSE_DIST) {
        pointsRef.current = [...pts, { ...pts[0] }]
        finish()
        return
      }
      pointsRef.current = [...pts, p]
      setPoints(pointsRef.current)
    },
    [finish],
  )

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (pointsRef.current.length === 0) return
    setCursor({ x: e.point.x, y: e.point.y })
  }, [])

  const onPointerUp = useCallback(() => {}, [])
  const onDoubleClick = useCallback(() => finish(), [finish])

  // Live preview = committed vertices + the rubber-band point to the cursor.
  const half = baseWidth / 2
  const raw = cursor && points.length > 0 ? [...points, cursor] : points
  const preview: SamplePoint[] = raw.map((p) => ({ x: p.x, y: p.y, w: half }))

  return { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, preview }
}
