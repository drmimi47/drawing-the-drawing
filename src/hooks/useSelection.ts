import { useCallback, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useDrawingStore } from '../store/drawingStore'

/**
 * Marquee selection (Cluster G, G2). Drag a rectangle in SELECT mode to select
 * the strokes whose geometry falls inside it. Selection drives the right-click
 * "Normalize" command (selection-scoped — normalization is never global).
 *
 * (Freehand lasso selection is a planned follow-up; it reuses the same selection
 * set and Normalize plumbing.)
 */

export interface MarqueeRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function useSelection() {
  const clearSelection = useDrawingStore((s) => s.clearSelection)

  const [marquee, setMarquee] = useState<MarqueeRect | null>(null)
  const activeRef = useRef(false)
  const startRef = useRef({ x: 0, y: 0 })

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      ;(e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.nativeEvent.pointerId)
      activeRef.current = true
      startRef.current = { x: e.point.x, y: e.point.y }
      setMarquee({ x0: e.point.x, y0: e.point.y, x1: e.point.x, y1: e.point.y })
      clearSelection()
    },
    [clearSelection],
  )

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!activeRef.current) return
    setMarquee({ x0: startRef.current.x, y0: startRef.current.y, x1: e.point.x, y1: e.point.y })
  }, [])

  const onPointerUp = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false

    setMarquee((rect) => {
      if (!rect) return null
      const minX = Math.min(rect.x0, rect.x1)
      const maxX = Math.max(rect.x0, rect.x1)
      const minY = Math.min(rect.y0, rect.y1)
      const maxY = Math.max(rect.y0, rect.y1)

      // A click (no drag) clears selection; a real drag selects.
      if (maxX - minX < 1e-3 && maxY - minY < 1e-3) {
        useDrawingStore.getState().clearSelection()
        return null
      }

      const graph = useDrawingStore.getState().graph
      const ids: string[] = []
      for (const stroke of graph.strokes) {
        const hit = stroke.path.some((pp) => {
          const v = graph.vertices[pp.v]
          return v && v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY
        })
        if (hit) ids.push(stroke.id)
      }
      useDrawingStore.getState().setSelection(ids)
      return null
    })
  }, [])

  return { marquee, onPointerDown, onPointerMove, onPointerUp }
}
