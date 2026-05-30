import { nextStrokeId, type Stroke, type StrokePoint } from '../store/drawingStore'

/**
 * Eraser geometry (Cluster C addition).
 *
 * A "typical" eraser removes the portion of a stroke under the cursor rather
 * than the whole stroke. Each stroke polyline is clipped against the eraser
 * circle: the parts outside the circle survive as new sub-strokes, and segments
 * crossing the boundary are split exactly at the circle edge.
 */

function lerpStrokePoint(p0: StrokePoint, p1: StrokePoint, t: number): StrokePoint {
  if (t <= 0) return { x: p0.x, y: p0.y, w: p0.w }
  if (t >= 1) return { x: p1.x, y: p1.y, w: p1.w }
  return {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    w: p0.w + (p1.w - p0.w) * t,
  }
}

/**
 * Clip a polyline against an erase circle, returning the surviving runs
 * (each a polyline of >= 2 points). An empty result means fully erased.
 */
export function erasePolyline(
  points: StrokePoint[],
  cx: number,
  cy: number,
  r: number,
): StrokePoint[][] {
  const n = points.length
  if (n < 2) return []
  const r2 = r * r

  const runs: StrokePoint[][] = []
  let current: StrokePoint[] | null = null
  let openAtVertex = false // current run's last point is the shared segment vertex

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const dx = p1.x - p0.x
    const dy = p1.y - p0.y
    const a = dx * dx + dy * dy

    // Find the t-interval [ti0, ti1] within [0,1] where the segment is inside
    // the circle (distance <= r).
    let ti0 = Infinity
    let ti1 = -Infinity
    if (a >= 1e-12) {
      const fx = p0.x - cx
      const fy = p0.y - cy
      const b = 2 * (fx * dx + fy * dy)
      const c2 = fx * fx + fy * fy - r2
      const disc = b * b - 4 * a * c2
      if (disc > 0) {
        const sq = Math.sqrt(disc)
        const t1 = (-b - sq) / (2 * a)
        const t2 = (-b + sq) / (2 * a)
        if (t2 > 0 && t1 < 1) {
          ti0 = Math.max(0, t1)
          ti1 = Math.min(1, t2)
        }
      }
    }
    const hasInside = ti1 > ti0

    // Outside intervals on this segment.
    const intervals: [number, number][] = []
    if (!hasInside) {
      intervals.push([0, 1])
    } else {
      if (ti0 > 0) intervals.push([0, ti0])
      if (ti1 < 1) intervals.push([ti1, 1])
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
 * Apply the eraser circle to every stroke. Returns the same array reference when
 * nothing changed, so callers can cheaply skip no-op updates.
 */
export function eraseStrokes(strokes: Stroke[], cx: number, cy: number, r: number): Stroke[] {
  let changed = false
  const out: Stroke[] = []

  for (const stroke of strokes) {
    const pts = stroke.points

    // Bounding-box quick reject.
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
    if (cx < minX - r || cx > maxX + r || cy < minY - r || cy > maxY + r) {
      out.push(stroke)
      continue
    }

    const runs = erasePolyline(pts, cx, cy, r)
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
