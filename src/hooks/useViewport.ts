import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useCanvasStore } from '../store/canvasStore'
import { computeViewportAABB, type ViewportAABB } from '../utils/viewport'

const EPSILON = 1e-3

/**
 * Tracks the visible viewport AABB and publishes it to the canvas store whenever
 * the camera moves or zooms (Cluster C). Must be mounted inside an R3F <Canvas>.
 * Cluster E reads this to decide which geometry is observed.
 */
export function useViewport() {
  const setViewport = useCanvasStore((s) => s.setViewport)
  const last = useRef<ViewportAABB | null>(null)

  useFrame((state) => {
    const aabb = computeViewportAABB(state.camera as OrthographicCamera)
    if (!aabb) return

    const prev = last.current
    const changed =
      !prev ||
      Math.abs(prev.minX - aabb.minX) > EPSILON ||
      Math.abs(prev.minY - aabb.minY) > EPSILON ||
      Math.abs(prev.maxX - aabb.maxX) > EPSILON ||
      Math.abs(prev.maxY - aabb.maxY) > EPSILON

    if (changed) {
      last.current = aabb
      setViewport(aabb)
    }
  })
}
