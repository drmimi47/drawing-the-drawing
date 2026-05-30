import type { Graph } from '../../types/geometry'

/**
 * Normalization mode (Cluster F) — local, corrective, procedural.
 *
 * When an unobserved edge re-enters the viewport, its orientation is nudged
 * toward the nearest 15° increment, scaled by how long it went unobserved. The
 * rotation pivots about whichever endpoint(s) are observed (so "what is watched
 * stays fixed"), and shared vertices average the proposals from their incident
 * edges — a light relaxation pass that keeps the graph from tearing.
 */

/** How long (ms) unobserved to reach full mutation magnitude. Tunable. */
export const DECAY_MAX_MS = 5000

const SNAP_STEP = Math.PI / 12 // 15 degrees

export interface ReentryEvent {
  v0: string
  v1: string
  /** Mutation magnitude 0..1 from time-outside (already decayed). */
  magnitude: number
}

/** Shortest signed angular difference target − current, in (−π, π]. */
function angleDelta(target: number, current: number): number {
  let d = target - current
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

/**
 * Compute target positions for the mutable vertices of the re-entering edges.
 * Returns a map of vertexId → new position (already relaxed/averaged).
 */
export function computeNormalizationTargets(
  graph: Graph,
  events: ReentryEvent[],
  isMutable: (vertexId: string) => boolean,
): Record<string, { x: number; y: number }> {
  const accum: Record<string, { x: number; y: number; count: number }> = {}
  const add = (id: string, x: number, y: number) => {
    const s = accum[id] ?? (accum[id] = { x: 0, y: 0, count: 0 })
    s.x += x
    s.y += y
    s.count++
  }

  for (const ev of events) {
    const a = graph.vertices[ev.v0]
    const b = graph.vertices[ev.v1]
    if (!a || !b) continue

    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue

    const angle = Math.atan2(dy, dx)
    const snapped = Math.round(angle / SNAP_STEP) * SNAP_STEP
    const newAngle = angle + angleDelta(snapped, angle) * ev.magnitude
    const ux = Math.cos(newAngle)
    const uy = Math.sin(newAngle)

    const aMutable = isMutable(ev.v0)
    const bMutable = isMutable(ev.v1)
    if (!aMutable && !bMutable) continue

    if (aMutable && bMutable) {
      // Rotate about the midpoint.
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      add(ev.v0, mx - (ux * len) / 2, my - (uy * len) / 2)
      add(ev.v1, mx + (ux * len) / 2, my + (uy * len) / 2)
    } else if (bMutable) {
      // Anchor a (observed); swing b.
      add(ev.v1, a.x + ux * len, a.y + uy * len)
    } else {
      // Anchor b (observed); swing a.
      add(ev.v0, b.x - ux * len, b.y - uy * len)
    }
  }

  const targets: Record<string, { x: number; y: number }> = {}
  for (const id in accum) {
    const s = accum[id]
    targets[id] = { x: s.x / s.count, y: s.y / s.count }
  }
  return targets
}
