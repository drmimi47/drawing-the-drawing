import { useCallback, useEffect, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'

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
    [camera, beginHistory, eraseCapsule, eraseSegmentAt],
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
