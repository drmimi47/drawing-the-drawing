import { useCallback } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'
import { isInsidePage } from '../geometry/page'

/** Click radius (screen px) for re-opening an existing label near its anchor. */
const EDIT_PICK_PX = 24

/**
 * Text tool (Edge-style). Click an empty spot to start a text box and type; the
 * DOM editor commits on Enter/blur. Clicking near an existing label's anchor
 * re-opens it for editing (clearing the text deletes it).
 */
export function useTextTool() {
  const { camera } = useThree()

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      const store = useDrawingStore.getState()
      if (store.pendingText) return

      const zoom = (camera as OrthographicCamera).zoom || 1
      const pickR = EDIT_PICK_PX / zoom
      const pickR2 = pickR * pickR
      const hit = store.textLabels.find((l) => {
        const dx = l.x - e.point.x
        const dy = l.y - e.point.y
        return dx * dx + dy * dy <= pickR2
      })

      if (hit) {
        store.beginText(hit.x, hit.y, e.nativeEvent.clientX, e.nativeEvent.clientY, hit.id, hit.text)
      } else {
        // New text may only be placed on the artboard, never in the grey workspace.
        if (!isInsidePage({ x: e.point.x, y: e.point.y }, store.pageWidth, store.pageHeight)) return
        store.beginText(e.point.x, e.point.y, e.nativeEvent.clientX, e.nativeEvent.clientY, null, '')
      }
    },
    [camera],
  )

  const onPointerMove = useCallback(() => {}, [])
  const onPointerUp = useCallback(() => {}, [])

  return { onPointerDown, onPointerMove, onPointerUp }
}
