import { useCallback, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'

/** Pick radius for grabbing an anchor point, in screen pixels. */
const PICK_RADIUS_PX = 10

/**
 * Direct vertex editing (Cluster G, G5) — Illustrator "direct selection" style.
 * In VECTOR mode, press near an anchor point to grab it and drag it; connected
 * strokes update live. One undo step per drag (snapshot on grab).
 *
 * Picking is done against the graph vertices on pointer-down (nearest within a
 * screen-space radius), so the visible handles can stay purely cosmetic.
 */
export function useVectorEdit() {
  const { camera } = useThree()
  const beginHistory = useDrawingStore((s) => s.beginHistory)
  const setVertexPositions = useDrawingStore((s) => s.setVertexPositions)
  const draggingRef = useRef<string | null>(null)

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      const zoom = (camera as OrthographicCamera).zoom || 1
      const radius = PICK_RADIUS_PX / zoom
      const r2 = radius * radius

      const graph = useDrawingStore.getState().graph
      let bestId: string | null = null
      let bestDist = r2
      for (const id in graph.vertices) {
        const v = graph.vertices[id]
        const dx = v.x - e.point.x
        const dy = v.y - e.point.y
        const d = dx * dx + dy * dy
        if (d <= bestDist) {
          bestDist = d
          bestId = id
        }
      }
      if (!bestId) return

      ;(e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.nativeEvent.pointerId)
      draggingRef.current = bestId
      beginHistory() // one undo step per drag
    },
    [camera, beginHistory],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const id = draggingRef.current
      if (!id) return
      setVertexPositions({ [id]: { x: e.point.x, y: e.point.y } })
    },
    [setVertexPositions],
  )

  const onPointerUp = useCallback(() => {
    draggingRef.current = null
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp }
}
