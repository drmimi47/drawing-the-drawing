/**
 * 2D geometric utilities for CAD-style polyline snapping (Step 1).
 *
 * All functions operate in world-space. Degenerate inputs (zero-length
 * reference edges, coincident points) return null instead of dividing by zero.
 */

type Vec2 = { x: number; y: number }

const EPS = 1e-10

/**
 * Project cursor point M onto the infinite line passing through A and B.
 * Returns A when A and B are coincident (degenerate line).
 */
export function getProjectedPointOnLine(M: Vec2, A: Vec2, B: Vec2): Vec2 {
  const dx = B.x - A.x
  const dy = B.y - A.y
  const len2 = dx * dx + dy * dy
  if (len2 < EPS) return { x: A.x, y: A.y }
  const t = ((M.x - A.x) * dx + (M.y - A.y) * dy) / len2
  return { x: A.x + t * dx, y: A.y + t * dy }
}

/**
 * Check if vector P→M is nearly parallel (or anti-parallel) to reference
 * edge A→B within `angularThresholdRad`. If so, return the snapped cursor
 * coordinate — M projected onto the ray from P in direction A→B.
 *
 * Uses the cross-product magnitude as a fast sine approximation so the
 * threshold is symmetric around both 0° and 180° without an atan2 call.
 */
export function checkParallelSnap(
  P: Vec2,
  M: Vec2,
  A: Vec2,
  B: Vec2,
  angularThresholdRad: number,
): Vec2 | null {
  const dx = B.x - A.x
  const dy = B.y - A.y
  const dLen = Math.sqrt(dx * dx + dy * dy)
  if (dLen < EPS) return null

  const vx = M.x - P.x
  const vy = M.y - P.y
  const vLen = Math.sqrt(vx * vx + vy * vy)
  if (vLen < EPS) return null

  const dnx = dx / dLen
  const dny = dy / dLen
  const vnx = vx / vLen
  const vny = vy / vLen

  // |cross(d̂, v̂)| = |sin θ|; small when parallel or anti-parallel
  const cross = Math.abs(dnx * vny - dny * vnx)
  if (cross > Math.sin(angularThresholdRad)) return null

  // Snap to the parallel ray from P: project M onto P + t·d̂
  const t = (M.x - P.x) * dnx + (M.y - P.y) * dny
  return { x: P.x + t * dnx, y: P.y + t * dny }
}

/**
 * Closest point on the FINITE segment A–B to M (clamped to the endpoints), with
 * its distance to M. Used for edge ("nearest on line") snapping. Returns A for a
 * degenerate zero-length segment.
 */
export function nearestPointOnSegment(M: Vec2, A: Vec2, B: Vec2): { x: number; y: number; dist: number } {
  const dx = B.x - A.x
  const dy = B.y - A.y
  const len2 = dx * dx + dy * dy
  let t = 0
  if (len2 >= EPS) {
    t = ((M.x - A.x) * dx + (M.y - A.y) * dy) / len2
    t = t < 0 ? 0 : t > 1 ? 1 : t
  }
  const x = A.x + t * dx
  const y = A.y + t * dy
  return { x, y, dist: Math.hypot(M.x - x, M.y - y) }
}

/**
 * Intersection of two INFINITE lines, one through A,B and one through C,D.
 * Returns null when the lines are parallel or colinear (no single crossing).
 *
 * Powers "apparent intersection" snapping: the crossing can lie far outside both
 * source segments (e.g. where two walls would meet if extended), so the caller
 * gates acceptance by the cursor's proximity to the returned point, not by
 * whether it lies on either segment.
 */
export function getLinesIntersection2D(A: Vec2, B: Vec2, C: Vec2, D: Vec2): Vec2 | null {
  const d1x = B.x - A.x
  const d1y = B.y - A.y
  const d2x = D.x - C.x
  const d2y = D.y - C.y
  // Cross of the two direction vectors; zero ⇒ parallel/colinear.
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < EPS) return null
  const t = ((C.x - A.x) * d2y - (C.y - A.y) * d2x) / denom
  return { x: A.x + t * d1x, y: A.y + t * d1y }
}

/**
 * Constrain point P to a horizontal or vertical line through `anchor` — whichever
 * axis the displacement is larger along (the standard Shift-drag ortho lock).
 */
export function snapOrtho(anchor: Vec2, p: Vec2): { x: number; y: number } {
  const dx = p.x - anchor.x
  const dy = p.y - anchor.y
  return Math.abs(dx) >= Math.abs(dy) ? { x: p.x, y: anchor.y } : { x: anchor.x, y: p.y }
}

/**
 * Check if cursor M is within `distanceThreshold` (world units) of the line
 * through P that is perpendicular to reference edge A→B. If so, return the
 * exact foot of perpendicular from M to that line (the snapped coordinate).
 *
 * The perpendicular direction is the 90°-rotated unit vector of A→B, so the
 * result is the closest point on the perp-line to M — not to segment A→B.
 */
export function checkPerpendicularSnap(
  P: Vec2,
  M: Vec2,
  A: Vec2,
  B: Vec2,
  distanceThreshold: number,
): Vec2 | null {
  const dx = B.x - A.x
  const dy = B.y - A.y
  const dLen = Math.sqrt(dx * dx + dy * dy)
  if (dLen < EPS) return null

  // Perpendicular direction to A→B (rotated 90°)
  const px = -dy / dLen
  const py = dx / dLen

  // Project M onto the perpendicular line through P: P + t·p̂
  const t = (M.x - P.x) * px + (M.y - P.y) * py
  const foot = { x: P.x + t * px, y: P.y + t * py }

  // Distance from M to the perp-line equals distance from M to its foot
  const ex = M.x - foot.x
  const ey = M.y - foot.y
  const dist = Math.sqrt(ex * ex + ey * ey)

  return dist <= distanceThreshold ? foot : null
}
