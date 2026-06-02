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

/** A pixel-space rectangle within the canvas container. */
export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Project the centered page-sheet rect (pageW × pageH world units, origin at its
 * center) into pixel coordinates within a container of size cw × ch, given the
 * currently visible world AABB. Returns null until the viewport is measured.
 * World +y is up, so the page's top edge (max world y) maps to the smaller pixel y.
 */
export function artboardScreenRect(
  pageW: number,
  pageH: number,
  view: ViewportAABB,
  cw: number,
  ch: number,
): ScreenRect | null {
  const vw = view.maxX - view.minX
  const vh = view.maxY - view.minY
  if (vw <= 0 || vh <= 0) return null
  const sx = (wx: number) => ((wx - view.minX) / vw) * cw
  const sy = (wy: number) => ((view.maxY - wy) / vh) * ch
  const left = sx(-pageW / 2)
  const right = sx(pageW / 2)
  const top = sy(pageH / 2)
  const bottom = sy(-pageH / 2)
  return { left, top, width: right - left, height: bottom - top }
}

/** Shrink an AABB by `margin` on every side. Returns the input if it would invert. */
export function insetAABB(a: ViewportAABB, margin: number): ViewportAABB {
  const minX = a.minX + margin
  const maxX = a.maxX - margin
  const minY = a.minY + margin
  const maxY = a.maxY - margin
  if (maxX < minX || maxY < minY) return a
  return { minX, maxX, minY, maxY }
}

/**
 * Does the segment (x0,y0)-(x1,y1) have any point inside the AABB? Liang-Barsky
 * clip: true iff the surviving parameter interval is non-empty.
 */
export function segmentIntersectsAABB(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  a: ViewportAABB,
): boolean {
  const dx = x1 - x0
  const dy = y1 - y0
  let t0 = 0
  let t1 = 1

  const edges: [number, number][] = [
    [-dx, x0 - a.minX],
    [dx, a.maxX - x0],
    [-dy, y0 - a.minY],
    [dy, a.maxY - y0],
  ]

  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false // parallel and outside this slab
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }

  return t0 <= t1
}
