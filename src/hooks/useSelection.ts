import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useDrawingStore } from '../store/drawingStore'

/**
 * Stroke selection (Cluster G). Two tools share this controller:
 *   - SELECT: marquee rectangle.
 *   - LASSO:  freehand polygon.
 * A stroke is selected if any of its vertices falls inside the region. Selection
 * drives the right-click "Normalize" command (normalization is never global).
 *
 * Exposes a world-space `outline` (closed) for the marching-ants overlay; it
 * shows live during a drag and persists around a committed selection.
 */

export interface SelectionOutline {
  points: { x: number; y: number }[]
  closed: boolean
}

const LASSO_MIN_STEP_SQ = 4 // world units² between captured lasso samples

function rectCorners(ax: number, ay: number, bx: number, by: number) {
  return [
    { x: ax, y: ay },
    { x: bx, y: ay },
    { x: bx, y: by },
    { x: ax, y: by },
  ]
}

export function useSelection() {
  const clearSelection = useDrawingStore((s) => s.clearSelection)
  const selectedCount = useDrawingStore((s) => s.selectedStrokeIds.length)

  const [outline, setOutline] = useState<SelectionOutline | null>(null)
  const activeRef = useRef(false)
  const modeRef = useRef<'marquee' | 'lasso'>('marquee')
  const ptsRef = useRef<{ x: number; y: number }[]>([])
  const startRef = useRef({ x: 0, y: 0 })
  const endRef = useRef({ x: 0, y: 0 })

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      ;(e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.nativeEvent.pointerId)
      activeRef.current = true
      clearSelection()

      const tool = useDrawingStore.getState().toolMode
      const p = { x: e.point.x, y: e.point.y }
      if (tool === 'LASSO') {
        modeRef.current = 'lasso'
        ptsRef.current = [p]
        setOutline({ points: [p], closed: true })
      } else {
        modeRef.current = 'marquee'
        startRef.current = p
        endRef.current = p
        setOutline({ points: rectCorners(p.x, p.y, p.x, p.y), closed: true })
      }
    },
    [clearSelection],
  )

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!activeRef.current) return
    const p = { x: e.point.x, y: e.point.y }
    if (modeRef.current === 'lasso') {
      const last = ptsRef.current[ptsRef.current.length - 1]
      const dx = p.x - last.x
      const dy = p.y - last.y
      if (dx * dx + dy * dy >= LASSO_MIN_STEP_SQ) {
        ptsRef.current.push(p)
        setOutline({ points: [...ptsRef.current], closed: true })
      }
    } else {
      endRef.current = p
      setOutline({ points: rectCorners(startRef.current.x, startRef.current.y, p.x, p.y), closed: true })
    }
  }, [])

  const onPointerUp = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false

    const store = useDrawingStore.getState()

    if (modeRef.current === 'lasso') {
      if (ptsRef.current.length >= 3) store.applyLassoSelection(ptsRef.current)
      else {
        store.clearSelection()
        setOutline(null)
      }
      return
    }

    const minX = Math.min(startRef.current.x, endRef.current.x)
    const maxX = Math.max(startRef.current.x, endRef.current.x)
    const minY = Math.min(startRef.current.y, endRef.current.y)
    const maxY = Math.max(startRef.current.y, endRef.current.y)
    if (maxX - minX < 1e-3 && maxY - minY < 1e-3) {
      store.clearSelection()
      setOutline(null)
      return
    }
    // Segment + select against the rectangle as a polygon.
    store.applyLassoSelection(rectCorners(minX, minY, maxX, maxY))
  }, [])

  // Drop the persistent outline when the selection is cleared elsewhere
  // (e.g. switching tools), but not mid-drag.
  useEffect(() => {
    if (selectedCount === 0 && !activeRef.current) setOutline(null)
  }, [selectedCount])

  return { outline, onPointerDown, onPointerMove, onPointerUp }
}
