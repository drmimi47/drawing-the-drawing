import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useCanvasStore } from '../../store/canvasStore'
import { useDrawingStore } from '../../store/drawingStore'
import { useViewport } from '../../hooks/useViewport'

/**
 * Infinite-canvas pan + zoom for the orthographic camera (Cluster C).
 *
 * - Zoom: scroll wheel, anchored to the cursor's world position (no drift).
 * - Pan: middle-mouse drag, space + left-drag, or left-drag while the Pan tool
 *   is active.
 *
 * Listeners are attached to the WebGL canvas / window directly so panning is
 * smooth and independent of the React render cycle. Mounted inside <Canvas>.
 */

const MIN_ZOOM = 0.2
const MAX_ZOOM = 20
const ZOOM_SPEED = 0.001

export function CameraControls() {
  const { camera, gl } = useThree()
  const setSpaceDown = useCanvasStore((s) => s.setSpaceDown)
  const setPanning = useCanvasStore((s) => s.setPanning)

  // Keep the published viewport AABB in sync with the camera.
  useViewport()

  useEffect(() => {
    const dom = gl.domElement
    const cam = camera as OrthographicCamera

    let panning = false
    let spaceDown = false
    let lastX = 0
    let lastY = 0

    const canPanWithLeft = () =>
      spaceDown || useDrawingStore.getState().toolMode === 'PAN'

    const onPointerDown = (e: PointerEvent) => {
      const isPan = e.button === 1 || (e.button === 0 && canPanWithLeft())
      if (!isPan) return
      e.preventDefault()
      panning = true
      setPanning(true)
      lastX = e.clientX
      lastY = e.clientY
      dom.setPointerCapture?.(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      // 1 screen pixel == 1/zoom world units for this ortho setup.
      cam.position.x -= dx / cam.zoom
      cam.position.y += dy / cam.zoom
    }

    const stopPanning = (e: PointerEvent) => {
      if (!panning) return
      panning = false
      setPanning(false)
      dom.releasePointerCapture?.(e.pointerId)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = dom.getBoundingClientRect()
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1)

      const halfWidthBefore = (cam.right - cam.left) / 2 / cam.zoom
      const halfHeightBefore = (cam.top - cam.bottom) / 2 / cam.zoom
      const worldX = cam.position.x + ndcX * halfWidthBefore
      const worldY = cam.position.y + ndcY * halfHeightBefore

      const factor = Math.exp(-e.deltaY * ZOOM_SPEED)
      cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor))
      cam.updateProjectionMatrix()

      // Re-anchor the cursor's world point so zoom feels centered on the pointer.
      const halfWidthAfter = (cam.right - cam.left) / 2 / cam.zoom
      const halfHeightAfter = (cam.top - cam.bottom) / 2 / cam.zoom
      cam.position.x = worldX - ndcX * halfWidthAfter
      cam.position.y = worldY - ndcY * halfHeightAfter
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceDown) {
        const target = e.target as HTMLElement | null
        const typing =
          target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (typing) return
        e.preventDefault()
        spaceDown = true
        setSpaceDown(true)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown = false
        setSpaceDown(false)
      }
    }

    dom.addEventListener('pointerdown', onPointerDown)
    dom.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopPanning)
    dom.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      dom.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopPanning)
      dom.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [camera, gl, setPanning, setSpaceDown])

  return null
}
