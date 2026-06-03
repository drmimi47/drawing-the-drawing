import { pointSegmentDistSq } from './graph'

/**
 * Lot-boundary segment editing (segment eraser, Stage 1). A closed ring has one
 * edge per vertex (including the closing edge last→first); an open chain (a ring
 * that has already lost a segment) has one fewer. Erasing the closing or any
 * interior edge opens the ring; erasing an edge of an already-open chain splits
 * it and keeps the longest surviving run.
 */

export interface Pt {
  x: number
  y: number
}

/** Nearest boundary edge to (x, y), or null. `closed` includes the last→first edge. */
export function nearestBoundarySegment(
  ring: Pt[],
  closed: boolean,
  x: number,
  y: number,
): { seg: number; distSq: number } | null {
  if (ring.length < 2) return null
  const edgeCount = closed ? ring.length : ring.length - 1
  let best: { seg: number; distSq: number } | null = null
  for (let i = 0; i < edgeCount; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const d = pointSegmentDistSq(x, y, a, b)
    if (!best || d < best.distSq) best = { seg: i, distSq: d }
  }
  return best
}

/**
 * Remove edge `seg` from the boundary. A closed ring becomes an OPEN chain (the
 * vertices rotated so the cut becomes the two free ends); an open chain is split
 * at the edge, keeping the longest run of ≥ 2 vertices. Returns the new ring with
 * its closed flag, or null when nothing erasable remains.
 */
export function eraseBoundarySegment(
  ring: Pt[],
  closed: boolean,
  seg: number,
): { ring: Pt[]; isClosed: boolean } | null {
  const n = ring.length
  if (closed) {
    if (n < 3) return null
    // Walk from just after the cut all the way around to the cut vertex.
    const chain: Pt[] = []
    for (let k = 1; k <= n; k++) chain.push({ ...ring[(seg + k) % n] })
    return { ring: chain, isClosed: false }
  }
  const runs = [ring.slice(0, seg + 1), ring.slice(seg + 1)].filter((p) => p.length >= 2)
  if (runs.length === 0) return null
  runs.sort((a, b) => b.length - a.length)
  return { ring: runs[0].map((p) => ({ x: p.x, y: p.y })), isClosed: false }
}
