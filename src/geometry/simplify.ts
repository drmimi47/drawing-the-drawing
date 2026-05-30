/**
 * Ramer-Douglas-Peucker polyline simplification (Cluster B/D).
 *
 * Generic over the point type so it preserves whatever attributes a point
 * carries (e.g. pressure and timestamp on raw samples) while only using x/y for
 * the distance test.
 */

interface Point2D {
  x: number
  y: number
}

/** Perpendicular distance from `pt` to the infinite line through `a` and `b`. */
function perpendicularDistance(pt: Point2D, a: Point2D, b: Point2D): number {
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
export function simplifyRDP<T extends Point2D>(points: T[], epsilon: number): T[] {
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
