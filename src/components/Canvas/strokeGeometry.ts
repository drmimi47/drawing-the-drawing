import type { SamplePoint } from '../../types/geometry'

/**
 * Stroke rendering geometry (Tier 3 — derived cache).
 *
 * Pipeline: editable path points → centripetal Catmull-Rom resample (smooth,
 * faithful centerline) → variable-width triangle ribbon with round caps. Native
 * WebGL lines can't vary thickness, and dense resampling removes the faceting
 * that plain RDP polylines show after a stroke is finalized.
 */

const RESAMPLE_SPACING = 3 // world units between resampled centerline points

/** Map a pressure value (0..1) to a half-width in world units. */
export function halfWidthForPressure(
  baseWidth: number,
  pressure: number,
  usePressure: boolean,
): number {
  const halfWidth = baseWidth / 2
  if (!usePressure) return halfWidth
  const clamped = Math.min(Math.max(pressure, 0), 1)
  return halfWidth * (0.3 + 1.2 * clamped)
}

export function rawToStrokePoints(
  points: { x: number; y: number; pressure: number }[],
  baseWidth: number,
  usePressure: boolean,
): SamplePoint[] {
  return points.map((p) => ({
    x: p.x,
    y: p.y,
    w: halfWidthForPressure(baseWidth, p.pressure, usePressure),
  }))
}

function dist(a: SamplePoint, b: SamplePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function lerp(a: SamplePoint, b: SamplePoint, s: number): SamplePoint {
  return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, w: a.w + (b.w - a.w) * s }
}

/**
 * Resample a polyline into a smooth, denser centerline using a centripetal
 * Catmull-Rom spline (alpha = 0.5: no cusps or self-intersections). End tangents
 * use reflected phantom points so the curve stays stable at the ends.
 */
export function resampleCentripetalCatmullRom(
  points: SamplePoint[],
  spacing: number = RESAMPLE_SPACING,
): SamplePoint[] {
  const n = points.length
  if (n < 3) return points.slice()

  const alpha = 0.5
  const out: SamplePoint[] = [points[0]]

  for (let i = 0; i < n - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    const p0 =
      i - 1 >= 0
        ? points[i - 1]
        : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, w: p1.w }
    const p3 =
      i + 2 < n
        ? points[i + 2]
        : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, w: p2.w }

    const t0 = 0
    const t1 = t0 + Math.pow(Math.max(dist(p0, p1), 1e-4), alpha)
    const t2 = t1 + Math.pow(Math.max(dist(p1, p2), 1e-4), alpha)
    const t3 = t2 + Math.pow(Math.max(dist(p2, p3), 1e-4), alpha)

    const steps = Math.max(1, Math.min(24, Math.ceil(dist(p1, p2) / spacing)))
    for (let s = 1; s <= steps; s++) {
      const u = s / steps
      const tt = t1 + (t2 - t1) * u
      const a1 = lerp(p0, p1, (tt - t0) / (t1 - t0))
      const a2 = lerp(p1, p2, (tt - t1) / (t2 - t1))
      const a3 = lerp(p2, p3, (tt - t2) / (t3 - t2))
      const b1 = lerp(a1, a2, (tt - t0) / (t2 - t0))
      const b2 = lerp(a2, a3, (tt - t1) / (t3 - t1))
      out.push(lerp(b1, b2, (tt - t1) / (t2 - t1)))
    }
  }

  return out
}

/**
 * Build a variable-width triangle ribbon with round end caps. The material is
 * double-sided, so triangle winding doesn't matter.
 */
export function buildRibbon(points: SamplePoint[]): {
  positions: Float32Array | null
  indices: Uint32Array | null
} {
  const n = points.length
  if (n < 2) return { positions: null, indices: null }

  const pos: number[] = []
  const idx: number[] = []

  // Two strip vertices (left, right) per centerline point. Offsets use a proper
  // MITER join (bisector scaled by 1/cos(half-angle)) so thickness stays constant
  // through corners instead of pinching; clamped to avoid spikes at sharp angles.
  const MITER_LIMIT = 4
  for (let i = 0; i < n; i++) {
    const cur = points[i]

    // Incoming / outgoing unit directions (fall back to the single edge at ends).
    let inx = cur.x - points[Math.max(0, i - 1)].x
    let iny = cur.y - points[Math.max(0, i - 1)].y
    let outx = points[Math.min(n - 1, i + 1)].x - cur.x
    let outy = points[Math.min(n - 1, i + 1)].y - cur.y
    const inLen = Math.hypot(inx, iny)
    const outLen = Math.hypot(outx, outy)
    if (inLen < 1e-9) {
      inx = outx
      iny = outy
    } else {
      inx /= inLen
      iny /= inLen
    }
    if (outLen < 1e-9) {
      outx = inx
      outy = iny
    } else {
      outx /= outLen
      outy /= outLen
    }

    // Edge normals (left side), then the miter (bisector) direction.
    const ninx = -iny
    const niny = inx
    const noutx = -outy
    const nouty = outx
    let mx = ninx + noutx
    let my = niny + nouty
    const mlen = Math.hypot(mx, my)
    if (mlen < 1e-6) {
      mx = ninx
      my = niny
    } else {
      mx /= mlen
      my /= mlen
    }
    const cosHalf = mx * ninx + my * niny
    const scale = Math.min(MITER_LIMIT, cosHalf > 1e-3 ? 1 / cosHalf : MITER_LIMIT)

    const hw = cur.w
    const ox = mx * hw * scale
    const oy = my * hw * scale
    pos.push(cur.x + ox, cur.y + oy, 0) // left  = 2i
    pos.push(cur.x - ox, cur.y - oy, 0) // right = 2i+1
  }

  for (let i = 0; i < n - 1; i++) {
    const l0 = i * 2
    const r0 = i * 2 + 1
    const l1 = (i + 1) * 2
    const r1 = (i + 1) * 2 + 1
    idx.push(l0, r0, l1, r0, r1, l1)
  }

  // Round caps: a half-disk fan around each endpoint, bulging outward.
  const addCap = (cx: number, cy: number, hw: number, outwardAngle: number) => {
    const steps = 10
    const center = pos.length / 3
    pos.push(cx, cy, 0)
    let prevIdx = -1
    for (let s = 0; s <= steps; s++) {
      const ang = outwardAngle - Math.PI / 2 + Math.PI * (s / steps)
      const vi = pos.length / 3
      pos.push(cx + Math.cos(ang) * hw, cy + Math.sin(ang) * hw, 0)
      if (prevIdx >= 0) idx.push(center, prevIdx, vi)
      prevIdx = vi
    }
  }

  const start = points[0]
  const afterStart = points[1]
  addCap(start.x, start.y, start.w, Math.atan2(start.y - afterStart.y, start.x - afterStart.x))

  const end = points[n - 1]
  const beforeEnd = points[n - 2]
  addCap(end.x, end.y, end.w, Math.atan2(end.y - beforeEnd.y, end.x - beforeEnd.x))

  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}
