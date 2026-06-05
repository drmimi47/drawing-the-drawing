import { pointSegmentDistSq } from './graph'
import { buildLotGrid } from './lotGrid'

/**
 * Snap targets derived from the lot's structural grid, so the Circulation tool can draw
 * paths that ride the grid (parallel/perpendicular to the established walls).
 *
 *   nodes         — grid line intersections (lattice points) inside the lot
 *   segments      — grid line segments (for landing anywhere along a line)
 *   boundaryNodes — points where grid lines meet the EXTERNAL lot boundary (the
 *                   preferred target for a circulation path's FIRST point)
 */

type Pt = { x: number; y: number }

export interface GridSnapModel {
  nodes: Pt[]
  segments: [Pt, Pt][]
  boundaryNodes: Pt[]
}

function distToRing(p: Pt, ring: Pt[]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const d = pointSegmentDistSq(p.x, p.y, ring[i], ring[(i + 1) % ring.length])
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

export function buildGridSnapModel(ring: Pt[], spacing: number, seams: Pt[][] = []): GridSnapModel | null {
  if (ring.length < 3) return null
  const sets = buildLotGrid(ring, spacing, seams)
  if (sets.length === 0) return null
  const nodes: Pt[] = []
  const segments: [Pt, Pt][] = []
  for (const s of sets) {
    nodes.push(...s.nodes)
    segments.push(...s.segments)
  }
  // Grid-line endpoints that sit on the external boundary.
  const eps = Math.max(2, spacing * 0.04)
  const seen = new Set<string>()
  const boundaryNodes: Pt[] = []
  for (const [a, b] of segments) {
    for (const p of [a, b]) {
      if (distToRing(p, ring) > eps) continue
      const key = `${Math.round(p.x)},${Math.round(p.y)}`
      if (!seen.has(key)) {
        seen.add(key)
        boundaryNodes.push(p)
      }
    }
  }
  return { nodes, segments, boundaryNodes }
}

/** Nearest point in a list within `thr`, or null. */
function nearestPoint(pts: Pt[], x: number, y: number, thr2: number): Pt | null {
  let best: Pt | null = null
  let bd = thr2
  for (const p of pts) {
    const dx = p.x - x
    const dy = p.y - y
    const d = dx * dx + dy * dy
    if (d < bd) {
      bd = d
      best = p
    }
  }
  return best
}

/** Projection of (x,y) onto segment [a,b]. */
function projectOnSeg(x: number, y: number, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/**
 * Snap (x,y) to the grid: nodes win over line projections (a vertex is a stronger
 * anchor than a free point on a line). The FIRST point of a path prefers boundary
 * intersections. Returns the snapped point, or null when nothing is within `thr`.
 */
export function snapToGrid(model: GridSnapModel, x: number, y: number, thr: number, firstPoint: boolean): Pt | null {
  const thr2 = thr * thr
  if (firstPoint) {
    const bn = nearestPoint(model.boundaryNodes, x, y, thr2)
    if (bn) return bn
  }
  const node = nearestPoint(model.nodes, x, y, thr2)
  if (node) return node
  let best: Pt | null = null
  let bd = thr2
  for (const [a, b] of model.segments) {
    const pr = projectOnSeg(x, y, a, b)
    const dx = pr.x - x
    const dy = pr.y - y
    const d = dx * dx + dy * dy
    if (d < bd) {
      bd = d
      best = pr
    }
  }
  return best
}
