import { useCallback, useEffect, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'
import { pointSegmentDistSq } from '../geometry/graph'

/** Eraser radius in screen pixels (constant on screen across zoom levels). */
export const ERASE_RADIUS_PX = 14

/**
 * Eraser controller (Cluster C; graph-aware since Cluster D). Drags erase the
 * swept capsule between the previous and current pointer positions, so fast
 * drags leave no gaps. The radius is constant in screen space (divided by zoom),
 * matching the eraser cursor at every zoom level.
 */
export function useEraser() {
  const { camera } = useThree()
  const beginHistory = useDrawingStore((s) => s.beginHistory)
  const eraseCapsule = useDrawingStore((s) => s.eraseCapsule)
  const eraseSegmentAt = useDrawingStore((s) => s.eraseSegmentAt)
  const eraseTextLabel = useDrawingStore((s) => s.eraseTextLabel)
  const eraseScribble = useDrawingStore((s) => s.eraseScribble)

  const erasingRef = useRef(false)
  const historyPushedRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)

  const sample = useCallback(
    (x: number, y: number) => {
      const zoom = (camera as OrthographicCamera).zoom || 1
      const radius = ERASE_RADIUS_PX / zoom

      // Polyline segment eraser: a click/swipe over a polyline (graph straight
      // stroke) or circulation centerline deletes just that segment, plus any lone
      // leftover vertex. Tried first; it's its own undoable step and bypasses the
      // capsule drag-history bookkeeping. Scribbles fall through to the capsule
      // below (unchanged behaviour).
      if (eraseSegmentAt(x, y, radius)) {
        lastRef.current = { x, y }
        return
      }

      // Text labels: contact anywhere over a label's footprint deletes the whole
      // sentence (its own undo step). The footprint is the label's top-left world
      // anchor extended right/down by an approximate text box (screen-constant font,
      // so the world size is px/zoom), padded by the eraser radius.
      const { textLabels, pendingText } = useDrawingStore.getState()
      const editingId = pendingText?.id ?? null
      for (const label of textLabels) {
        if (label.id === editingId) continue
        const lines = label.text.split('\n')
        const cols = lines.reduce((m, l) => Math.max(m, l.length), 1)
        const wWorld = (cols * label.size * 0.6) / zoom // ~0.6 avg char advance
        const hWorld = (lines.length * label.size) / zoom // line-height 1
        if (
          x >= label.x - radius &&
          x <= label.x + wWorld + radius &&
          y <= label.y + radius &&
          y >= label.y - hWorld - radius
        ) {
          eraseTextLabel(label.id)
          lastRef.current = { x, y }
          return
        }
      }

      // Scribbles: contact anywhere along a scribble deletes the WHOLE stroke at
      // once (Figma-style), since a scribble is one atomic raster mark.
      const { scribbles } = useDrawingStore.getState()
      for (const sc of scribbles) {
        const hitR = radius + sc.width / 2
        const hitR2 = hitR * hitR
        const pts = sc.points
        if (pts.length === 1) {
          const dx = x - pts[0].x
          const dy = y - pts[0].y
          if (dx * dx + dy * dy <= hitR2) {
            eraseScribble(sc.id)
            lastRef.current = { x, y }
            return
          }
          continue
        }
        for (let i = 0; i < pts.length - 1; i++) {
          if (pointSegmentDistSq(x, y, pts[i], pts[i + 1]) <= hitR2) {
            eraseScribble(sc.id)
            lastRef.current = { x, y }
            return
          }
        }
      }

      const last = lastRef.current ?? { x, y }
      lastRef.current = { x, y }

      // Snapshot once per drag, the first time something is actually erased.
      if (!historyPushedRef.current) {
        beginHistory()
        historyPushedRef.current = true
        const changed = eraseCapsule(last.x, last.y, x, y, radius)
        if (!changed) {
          // Nothing erased yet — don't waste the snapshot on a no-op.
          useDrawingStore.setState((s) => ({ past: s.past.slice(0, -1) }))
          historyPushedRef.current = false
        }
        return
      }
      eraseCapsule(last.x, last.y, x, y, radius)
    },
    [camera, beginHistory, eraseCapsule, eraseSegmentAt, eraseTextLabel, eraseScribble],
  )

  useEffect(() => {
    const onUp = () => {
      erasingRef.current = false
    }
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      ;(e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.nativeEvent.pointerId)
      erasingRef.current = true
      historyPushedRef.current = false
      lastRef.current = null // start fresh; first sample erases a circle
      sample(e.point.x, e.point.y)
    },
    [sample],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!erasingRef.current) return
      sample(e.point.x, e.point.y)
    },
    [sample],
  )

  const onPointerUp = useCallback(() => {
    erasingRef.current = false
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp }
}
