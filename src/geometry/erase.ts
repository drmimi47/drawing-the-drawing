import { nextStrokeId, type Stroke, type StrokePoint } from '../store/drawingStore'

/**
 * Eraser geometry (Cluster C addition).
 *
 * A "typical" eraser removes the portion of a stroke under the cursor rather
 * than the whole stroke. To avoid gaps when the pointer moves fast, we erase the
 * swept *capsule* between the previous and current eraser positions (a segment
 * with radius r), not a circle at a single sample. Consecutive capsules share an
 * endpoint, so the erased swath is continuous with no leftover pieces.
 *
 * Each stroke polyline is clipped against the capsule: parts outside it survive
 * as new sub-strokes, and segments crossing the boundary are split exactly at
 * the edge.
 */

interface Interval {
  ti0: number
  ti1: number
}

function lerpStrokePoint(p0: StrokePoint, p1: StrokePoint, t: number): StrokePoint {
  if (t <= 0) return { x: p0.x, y: p0.y, w: p0.w }
  if (t >= 1) return { x: p1.x, y: p1.y, w: p1.w }
  return {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    w: p0.w + (p1.w - p0.w) * t,
  }
}

/** Squared distance from point (px,py) to segment (ax,ay)-(bx,by). */
function distSqPointSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = ax + t * dx
  const cy = ay + t * dy
  const ex = px - cx
  const ey = py - cy
  return ex * ex + ey * ey
}

/**
 * Build the surviving runs of a polyline given a function that returns, for each
 * segment, the sub-interval [ti0,ti1] of t in [0,1] that lies INSIDE the eraser
 * (or null if the segment is entirely outside). The eraser region is convex, so
 * each segment has at most one inside interval.
 */
function clipPolyline(
  points: StrokePoint[],
  insideInterval: (p0: StrokePoint, p1: StrokePoint) => Interval | null,
): StrokePoint[][] {
  const n = points.length
  if (n < 2) return []

  const runs: StrokePoint[][] = []
  let current: StrokePoint[] | null = null
  let openAtVertex = false // current run's last point is the shared segment vertex

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const inside = insideInterval(p0, p1)

    const intervals: [number, number][] = []
    if (!inside) {
      intervals.push([0, 1])
    } else {
      if (inside.ti0 > 0) intervals.push([0, inside.ti0])
      if (inside.ti1 < 1) intervals.push([inside.ti1, 1])
      // ti0 <= 0 && ti1 >= 1 → fully inside → nothing survives
    }

    if (intervals.length === 0) {
      if (current && current.length >= 2) runs.push(current)
      current = null
      openAtVertex = false
      continue
    }

    for (const [s, e] of intervals) {
      const continuing = current && openAtVertex && s === 0
      if (!continuing) {
        if (current && current.length >= 2) runs.push(current)
        current = [lerpStrokePoint(p0, p1, s)]
      }
      current!.push(lerpStrokePoint(p0, p1, e))

      if (e >= 1) {
        openAtVertex = true
      } else {
        if (current!.length >= 2) runs.push(current!)
        current = null
        openAtVertex = false
      }
    }
  }

  if (current && current.length >= 2) runs.push(current)
  return runs
}

/**
 * Apply the eraser capsule (segment A→B, radius r) to every stroke. Returns the
 * same array reference when nothing changed, so callers can skip no-op updates.
 */
export function eraseStrokesCapsule(
  strokes: Stroke[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): Stroke[] {
  const r2 = r * r
  const capMinX = Math.min(ax, bx) - r
  const capMaxX = Math.max(ax, bx) + r
  const capMinY = Math.min(ay, by) - r
  const capMaxY = Math.max(ay, by) + r

  // Inside interval for one polyline segment vs. the capsule. distSq to the
  // capsule axis is convex in t, so {t : distSq <= r^2} is a single interval,
  // found by minimizing then bisecting toward each boundary.
  const insideInterval = (p0: StrokePoint, p1: StrokePoint): Interval | null => {
    // Quick reject via segment bounding box.
    const sMinX = Math.min(p0.x, p1.x)
    const sMaxX = Math.max(p0.x, p1.x)
    const sMinY = Math.min(p0.y, p1.y)
    const sMaxY = Math.max(p0.y, p1.y)
    if (sMaxX < capMinX || sMinX > capMaxX || sMaxY < capMinY || sMinY > capMaxY) return null

    const h = (t: number): number => {
      const x = p0.x + (p1.x - p0.x) * t
      const y = p0.y + (p1.y - p0.y) * t
      return distSqPointSegment(x, y, ax, ay, bx, by) - r2
    }

    // Ternary search for the minimum of the convex h(t).
    let lo = 0
    let hi = 1
    for (let i = 0; i < 30; i++) {
      const m1 = lo + (hi - lo) / 3
      const m2 = hi - (hi - lo) / 3
      if (h(m1) < h(m2)) hi = m2
      else lo = m1
    }
    const tmin = (lo + hi) / 2
    if (h(tmin) > 0) return null // closest approach still outside the capsule

    // Left boundary in [0, tmin].
    let ti0: number
    if (h(0) <= 0) {
      ti0 = 0
    } else {
      let a = 0
      let b = tmin
      for (let i = 0; i < 30; i++) {
        const m = (a + b) / 2
        if (h(m) > 0) a = m
        else b = m
      }
      ti0 = b
    }

    // Right boundary in [tmin, 1].
    let ti1: number
    if (h(1) <= 0) {
      ti1 = 1
    } else {
      let a = tmin
      let b = 1
      for (let i = 0; i < 30; i++) {
        const m = (a + b) / 2
        if (h(m) <= 0) a = m
        else b = m
      }
      ti1 = a
    }

    return ti1 > ti0 ? { ti0, ti1 } : null
  }

  let changed = false
  const out: Stroke[] = []

  for (const stroke of strokes) {
    const pts = stroke.points

    // Bounding-box quick reject for the whole stroke.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of pts) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    if (capMaxX < minX || capMinX > maxX || capMaxY < minY || capMinY > maxY) {
      out.push(stroke)
      continue
    }

    const runs = clipPolyline(pts, insideInterval)
    if (runs.length === 1 && runs[0].length === pts.length) {
      out.push(stroke)
      continue
    }

    changed = true
    for (const run of runs) {
      out.push({ id: nextStrokeId(), color: stroke.color, points: run })
    }
  }

  return changed ? out : strokes
}
