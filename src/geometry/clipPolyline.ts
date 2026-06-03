/**
 * Clip an open polyline to the interior of a polygon, keeping only the portions
 * that fall INSIDE the polygon. A single input path can yield several output
 * pieces when it exits and re-enters the polygon (each run inside is its own
 * polyline). Used to trim circulation centerlines to the lot boundary so the user
 * can draw freely without worrying about overshooting the lot.
 */

export interface Pt {
  x: number
  y: number
}

/** Ray-casting point-in-polygon test (polygon given as an unclosed ring). */
function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Parameter t∈(0,1) along a→b where it properly crosses segment c→d, or null.
 * Endpoints (t=0/1) are excluded; the crossing must also lie within c→d (u∈[0,1]).
 */
function segCrossT(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-12) return null // parallel or collinear
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom
  if (t > 0 && t < 1 && u >= 0 && u <= 1) return t
  return null
}

/**
 * Keep the parts of `line` that lie inside `poly`. Returns zero or more polylines
 * (each ≥ 2 points). When `poly` is degenerate (< 3 verts) the line is returned
 * unchanged so callers can treat "no boundary" as "no clipping".
 */
export function clipPolylineToPolygon(line: Pt[], poly: Pt[]): Pt[][] {
  if (line.length < 2) return []
  if (poly.length < 3) return [line.map((p) => ({ x: p.x, y: p.y }))]

  // Build an augmented path = original vertices + every boundary crossing, in
  // path order. Each consecutive pair is then wholly inside or wholly outside.
  const aug: Pt[] = [{ x: line[0].x, y: line[0].y }]
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    const ts: number[] = []
    for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
      const t = segCrossT(a, b, poly[k], poly[j])
      if (t != null) ts.push(t)
    }
    ts.sort((m, n) => m - n)
    let prev = -1
    for (const t of ts) {
      if (t - prev < 1e-9) continue // collapse duplicate crossings (e.g. through a vertex)
      prev = t
      aug.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
    aug.push({ x: b.x, y: b.y })
  }

  // Group maximal runs of sub-segments whose midpoint is inside the polygon.
  const result: Pt[][] = []
  let current: Pt[] = []
  for (let i = 0; i < aug.length - 1; i++) {
    const p = aug[i]
    const q = aug[i + 1]
    if (Math.abs(p.x - q.x) < 1e-12 && Math.abs(p.y - q.y) < 1e-12) continue // skip zero-length
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
    if (pointInPolygon(mid, poly)) {
      if (current.length === 0) current.push(p)
      current.push(q)
    } else if (current.length >= 2) {
      result.push(current)
      current = []
    } else {
      current = []
    }
  }
  if (current.length >= 2) result.push(current)
  return result
}
