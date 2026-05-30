/**
 * Ramer-Douglas-Peucker polyline simplification (Cluster B).
 *
 * Reduces a noisy raw freehand point stream to a compact polyline while keeping
 * the per-point pressure value `p`, which later drives variable stroke width.
 */

export interface RawPoint {
  x: number
  y: number
  /** Pointer pressure 0..1 (0.5 for mouse, variable for pen). */
  p: number
}

/** Perpendicular distance from `pt` to the infinite line through `a` and `b`. */
function perpendicularDistance(pt: RawPoint, a: RawPoint, b: RawPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(pt.x - a.x, pt.y - a.y)

  const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lengthSq
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(pt.x - projX, pt.y - projY)
}

/**
 * Simplify `points`, keeping any point that deviates more than `epsilon`
 * (world units) from the line between its retained neighbours.
 */
export function simplifyRDP(points: RawPoint[], epsilon: number): RawPoint[] {
  if (points.length <= 2) return points.slice()

  const first = points[0]
  const last = points[points.length - 1]

  let maxDistance = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], first, last)
    if (distance > maxDistance) {
      maxDistance = distance
      index = i
    }
  }

  if (maxDistance > epsilon) {
    const left = simplifyRDP(points.slice(0, index + 1), epsilon)
    const right = simplifyRDP(points.slice(index), epsilon)
    // Drop the duplicated join point shared by both halves.
    return left.slice(0, -1).concat(right)
  }

  return [first, last]
}
