import type { Graph, LockPolygon } from '../types/geometry'

/**
 * Lock-field math (Cluster H). Influence is an INTERIOR distance field: a lock
 * polygon is hard-locked (1.0) deep in its core and feathers DOWN to 0 as it
 * approaches the boundary — the negotiation zone. Outside the polygon influence
 * is 0. `featherRadius` is the width of the edge falloff band; cores deeper than
 * that saturate at 1.0. Multiple locks combine by taking the maximum (union).
 *
 * The same field drives both the visual gradient and "Clean up": a vertex's
 * normalize strength is scaled by (1 - influence).
 */

export const DEFAULT_FEATHER_RADIUS = 60 // width (world units) of the edge falloff band

type Pt = { x: number; y: number }

export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Minimum distance from a point to the polygon boundary. */
export function distanceToPolygonBoundary(x: number, y: number, poly: Pt[]): number {
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = distanceToSegment(x, y, poly[j].x, poly[j].y, poly[i].x, poly[i].y)
    if (d < best) best = d
  }
  return best
}

/** Interior distance-field influence (0..1) of a single lock polygon at a point. */
function polygonInfluence(x: number, y: number, poly: LockPolygon): number {
  if (poly.points.length < 3) return 0
  if (!pointInPolygon(x, y, poly.points)) return 0 // outside ⇒ free
  if (poly.featherRadius <= 0) return 1
  // Distance inward from the boundary: 0 at the edge → 1.0 once past featherRadius.
  const d = distanceToPolygonBoundary(x, y, poly.points)
  return Math.min(d / poly.featherRadius, 1)
}

/** Combined lock influence (0..1) at a point across all lock polygons. */
export function lockInfluenceAt(x: number, y: number, locks: LockPolygon[]): number {
  let influence = 0
  for (const lock of locks) {
    const i = polygonInfluence(x, y, lock)
    if (i > influence) influence = i
    if (influence >= 1) return 1
  }
  return influence
}

/** Per-vertex lock influence for the whole graph. */
export function computeLockInfluences(graph: Graph, locks: LockPolygon[]): Map<string, number> {
  const out = new Map<string, number>()
  if (locks.length === 0) return out
  for (const id in graph.vertices) {
    const v = graph.vertices[id]
    const inf = lockInfluenceAt(v.x, v.y, locks)
    if (inf > 0) out.set(id, inf)
  }
  return out
}
