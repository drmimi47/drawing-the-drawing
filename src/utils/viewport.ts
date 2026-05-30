import type { OrthographicCamera } from 'three'

/** World-space axis-aligned bounding box of the visible viewport. */
export interface ViewportAABB {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Compute the world-space rectangle currently visible through an orthographic
 * camera. R3F sizes the frustum to the canvas (left/right/top/bottom in pixels),
 * and `zoom` scales it, so the visible half-extents are `(half frustum) / zoom`.
 */
export function computeViewportAABB(camera: OrthographicCamera): ViewportAABB | null {
  const halfWidth = (camera.right - camera.left) / 2 / camera.zoom
  const halfHeight = (camera.top - camera.bottom) / 2 / camera.zoom
  if (!isFinite(halfWidth) || halfWidth <= 0) return null

  return {
    minX: camera.position.x - halfWidth,
    maxX: camera.position.x + halfWidth,
    minY: camera.position.y - halfHeight,
    maxY: camera.position.y + halfHeight,
  }
}
