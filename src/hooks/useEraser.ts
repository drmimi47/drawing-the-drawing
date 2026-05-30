import { useCallback, useEffect, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'
import { eraseStrokesCapsule } from '../geometry/erase'

/** Eraser radius in screen pixels (constant on screen across zoom levels). */
export const ERASE_RADIUS_PX = 14

/**
 * Eraser controller (Cluster C addition). Drag over strokes to erase the parts
 * under the cursor. The radius is kept constant in screen space by dividing by
 * the camera zoom, so it matches the eraser cursor at every zoom level.
 */
export function useEraser() {
  const { camera } = useThree()
  const beginHistory = useDrawingStore((s) => s.beginHistory)
  const setStrokes = useDrawingStore((s) => s.setStrokes)

  const erasingRef = useRef(false)
  const historyPushedRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)

  const sample = useCallback(
    (x: number, y: number) => {
      const zoom = (camera as OrthographicCamera).zoom || 1
      const radius = ERASE_RADIUS_PX / zoom
      // Erase the swept capsule from the previous point to this one (a point on
      // the first sample), so fast drags leave no gaps.
      const last = lastRef.current ?? { x, y }
      lastRef.current = { x, y }

      const current = useDrawingStore.getState().strokes
      const next = eraseStrokesCapsule(current, last.x, last.y, x, y, radius)
      if (next !== current) {
        // One undo step per erase drag: snapshot the first time it changes.
        if (!historyPushedRef.current) {
          beginHistory()
          historyPushedRef.current = true
        }
        setStrokes(next)
      }
    },
    [camera, beginHistory, setStrokes],
  )

  // Stop erasing even if the pointer is released off the canvas.
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
