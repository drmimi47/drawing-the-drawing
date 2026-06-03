/**
 * Polygon area + real-world conversion (Gradia Draw restructure — Stage 1).
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

/** Compact thousands-grouped integer for area HUDs (e.g. 45,000). */
export function formatArea(value: number): string {
  return Math.round(value).toLocaleString()
}
