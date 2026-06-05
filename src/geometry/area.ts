/**
 * Polygon area + real-world conversion (Gradia restructure — Stage 1).
 *
 * Areas are computed in WORLD units² via the shoelace formula, then converted to
 * real units using the live Mercator scale (metersPerWorldUnit) when a map is
 * registered. Blank-sheet mode has no real scale, so callers fall back to world
 * units².
 */

const SQM_TO_SQFT = 10.7639

type Pt = { x: number; y: number }

/**
 * Absolute polygon area in WORLD units² (shoelace). Treats the ring as closed
 * whether or not the last point repeats the first.
 */
export function polygonAreaWorld(ring: Pt[]): number {
  const n = ring.length
  if (n < 3) return 0
  let sum = 0
  for (let i = 0, j = n - 1; i < n; j = i++) {
    sum += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y)
  }
  return Math.abs(sum) / 2
}

/** World units² → real ft², given the live meters-per-world-unit scale. */
export function worldAreaToSqft(worldArea: number, metersPerWorldUnit: number): number {
  const m2 = worldArea * metersPerWorldUnit * metersPerWorldUnit
  return m2 * SQM_TO_SQFT
}

/**
 * Inverse of worldAreaToSqft: a real target area (ft²) → WORLD units². With no map
 * scale the canvas has no real units, so the target is already in world units².
 */
export function sqftToWorldArea(sqft: number, metersPerWorldUnit: number | null): number {
  if (metersPerWorldUnit != null && metersPerWorldUnit > 0) {
    return sqft / (metersPerWorldUnit * metersPerWorldUnit * SQM_TO_SQFT)
  }
  return sqft
}

/**
 * Area-weighted polygon centroid (shoelace). Falls back to the vertex average for a
 * degenerate (near-zero-area) ring so the result is always finite.
 */
export function ringCentroid(ring: Pt[]): Pt {
  const n = ring.length
  if (n === 0) return { x: 0, y: 0 }
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const cross = ring[j].x * ring[i].y - ring[i].x * ring[j].y
    a += cross
    cx += (ring[j].x + ring[i].x) * cross
    cy += (ring[j].y + ring[i].y) * cross
  }
  a *= 0.5
  if (Math.abs(a) < 1e-9) {
    let sx = 0
    let sy = 0
    for (const p of ring) {
      sx += p.x
      sy += p.y
    }
    return { x: sx / n, y: sy / n }
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

/**
 * Uniformly scale `ring` about `anchor` (default: its centroid) so its enclosed area
 * becomes `targetWorldArea`. A similarity transform preserves the polygon's shape and
 * changes its area by the square of the scale, so a single sqrt solves it exactly.
 *
 * Scaling about a vertex keeps THAT vertex fixed while every other vertex moves — this
 * is what lets a dragged corner stay put while the rest of the lot re-fits the target.
 * Returns the ring unchanged when it's degenerate or the target is non-positive (no
 * runaway scale from a near-zero current area).
 */
export function scaleRingToArea(ring: Pt[], targetWorldArea: number, anchor?: Pt): Pt[] {
  if (ring.length < 3 || targetWorldArea <= 0) return ring
  const area = polygonAreaWorld(ring)
  if (area < 1e-9) return ring
  const s = Math.sqrt(targetWorldArea / area)
  if (!isFinite(s) || s <= 0) return ring
  const c = anchor ?? ringCentroid(ring)
  return ring.map((p) => ({ x: c.x + (p.x - c.x) * s, y: c.y + (p.y - c.y) * s }))
}

/** Compact thousands-grouped integer for area HUDs (e.g. 45,000). */
export function formatArea(value: number): string {
  return Math.round(value).toLocaleString()
}
