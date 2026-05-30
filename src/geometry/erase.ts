import type { SamplePoint } from '../types/geometry'

/**
 * Eraser geometry (Cluster C; representation-agnostic since Cluster D).
 *
 * Clips a single centerline polyline against the swept eraser *capsule* (segment
 * A→B, radius r) — not a circle at one sample — so fast drags leave no gaps.
 * Returns the surviving runs plus whether anything was actually removed. The
 * graph layer turns the runs back into strokes/vertices.
 *
 * IMPORTANT: "modified" tracks whether the capsule intersected the polyline at
 * all. Do NOT infer "unchanged" from point count — trimming an end keeps the
 * count but moves the endpoint, which previously left fragments behind.
 */

interface Interval {
  ti0: number
  ti1: number
}

function lerpSamplePoint(p0: SamplePoint, p1: SamplePoint, t: number): SamplePoint {
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

function clipPolyline(
  points: SamplePoint[],
  insideInterval: (p0: SamplePoint, p1: SamplePoint) => Interval | null,
): { runs: SamplePoint[][]; modified: boolean } {
  const n = points.length
  if (n < 2) return { runs: [], modified: false }

  const runs: SamplePoint[][] = []
  let current: SamplePoint[] | null = null
  let openAtVertex = false
  let modified = false

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const inside = insideInterval(p0, p1)
    if (inside) modified = true

    const intervals: [number, number][] = []
    if (!inside) {
      intervals.push([0, 1])
    } else {
      if (inside.ti0 > 0) intervals.push([0, inside.ti0])
      if (inside.ti1 < 1) intervals.push([inside.ti1, 1])
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
        current = [lerpSamplePoint(p0, p1, s)]
      }
      current!.push(lerpSamplePoint(p0, p1, e))

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
  return { runs, modified }
}

/**
 * Clip one polyline against the eraser capsule (A→B, radius r). distSq to the
 * capsule axis is convex along each segment, so {t : distSq <= r^2} is a single
 * interval, found by minimizing then bisecting toward each boundary.
 */
export function clipPolylineCapsule(
  points: SamplePoint[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): { runs: SamplePoint[][]; modified: boolean } {
  const r2 = r * r
  const capMinX = Math.min(ax, bx) - r
  const capMaxX = Math.max(ax, bx) + r
  const capMinY = Math.min(ay, by) - r
  const capMaxY = Math.max(ay, by) + r

  const insideInterval = (p0: SamplePoint, p1: SamplePoint): Interval | null => {
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

    let lo = 0
    let hi = 1
    for (let i = 0; i < 30; i++) {
      const m1 = lo + (hi - lo) / 3
      const m2 = hi - (hi - lo) / 3
      if (h(m1) < h(m2)) hi = m2
      else lo = m1
    }
    const tmin = (lo + hi) / 2
    if (h(tmin) > 0) return null

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

  return clipPolyline(points, insideInterval)
}
