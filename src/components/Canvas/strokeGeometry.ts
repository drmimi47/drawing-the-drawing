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

/**
 * Convert pointer samples to centerline points at a FIXED, uniform half-width.
 * Pressure / tilt / speed are deliberately ignored — every stroke is the same
 * thickness from start to finish.
 */
export function rawToStrokePoints(
  points: { x: number; y: number }[],
  baseWidth: number,
): SamplePoint[] {
  const halfWidth = baseWidth / 2
  return points.map((p) => ({ x: p.x, y: p.y, w: halfWidth }))
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
 * Build a clean, UNIFORM-width ribbon from a centerline (round caps + round
 * joins). Every point shares the same half-width — no pressure, tapering, or
 * width smoothing. Each vertex is offset along the normal of its averaged
 * tangent, which on a densely resampled curve yields smooth, consistent edges;
 * a half-disk fan at each end gives the round line cap. The material is
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
  const hw = points[0].w // uniform half-width

  // Averaged unit tangent at point i (incoming + outgoing direction).
  const tangentAt = (i: number): [number, number] => {
    let inx = points[i].x - points[Math.max(0, i - 1)].x
    let iny = points[i].y - points[Math.max(0, i - 1)].y
    let outx = points[Math.min(n - 1, i + 1)].x - points[i].x
    let outy = points[Math.min(n - 1, i + 1)].y - points[i].y
    const il = Math.hypot(inx, iny)
    const ol = Math.hypot(outx, outy)
    if (il > 1e-9) { inx /= il; iny /= il } else { inx = outx; iny = outy }
    if (ol > 1e-9) { outx /= ol; outy /= ol } else { outx = inx; outy = iny }
    let tx = inx + outx
    let ty = iny + outy
    const tl = Math.hypot(tx, ty)
    if (tl < 1e-6) { tx = outx; ty = outy } else { tx /= tl; ty /= tl }
    return [tx, ty]
  }

  // Two strip vertices (left, right) per centerline point, offset along the
  // normal of the averaged tangent.
  for (let i = 0; i < n; i++) {
    const [tx, ty] = tangentAt(i)
    const nx = -ty
    const ny = tx
    pos.push(points[i].x + nx * hw, points[i].y + ny * hw, 0) // left  = 2i
    pos.push(points[i].x - nx * hw, points[i].y - ny * hw, 0) // right = 2i+1
  }

  for (let i = 0; i < n - 1; i++) {
    const l0 = i * 2
    const r0 = i * 2 + 1
    const l1 = (i + 1) * 2
    const r1 = (i + 1) * 2 + 1
    idx.push(l0, r0, l1, r0, r1, l1)
  }

  // Round caps: a half-disk fan bulging outward from each endpoint along the
  // true end tangent (the round line cap), at the same uniform radius.
  const addCap = (cx: number, cy: number, outwardAngle: number) => {
    const steps = 16
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

  // Find the first/last neighbours that are distinct enough for a stable tangent.
  let sj = 1
  while (sj < n - 1 && dist(points[0], points[sj]) < 1e-4) sj++
  let ej = n - 2
  while (ej > 0 && dist(points[n - 1], points[ej]) < 1e-4) ej--

  const start = points[0]
  addCap(start.x, start.y, Math.atan2(start.y - points[sj].y, start.x - points[sj].x))

  const end = points[n - 1]
  addCap(end.x, end.y, Math.atan2(end.y - points[ej].y, end.x - points[ej].x))

  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}

const POLYLINE_MITER_LIMIT = 4

/**
 * Build a TRUE vertex-to-vertex polyline ribbon: each segment is an independent
 * rectangle of the given thickness, and interior vertices get a miter join
 * (sharp corners; bevel fallback past the miter limit). No smoothing, no shared
 * miter strip, so corners stay sharp and never pinch. Butt caps at the ends.
 */
export function buildPolylineRibbon(points: SamplePoint[]): {
  positions: Float32Array | null
  indices: Uint32Array | null
} {
  const n = points.length
  if (n < 2) return { positions: null, indices: null }

  const pos: number[] = []
  const idx: number[] = []

  const addTri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    const base = pos.length / 3
    pos.push(ax, ay, 0, bx, by, 0, cx, cy, 0)
    idx.push(base, base + 1, base + 2)
  }

  // Per-segment rectangles (offset each end along that segment's own normal).
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    let dx = b.x - a.x
    let dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    dx /= len
    dy /= len
    const nx = -dy
    const ny = dx
    const a0x = a.x + nx * a.w
    const a0y = a.y + ny * a.w
    const a1x = a.x - nx * a.w
    const a1y = a.y - ny * a.w
    const b0x = b.x + nx * b.w
    const b0y = b.y + ny * b.w
    const b1x = b.x - nx * b.w
    const b1y = b.y - ny * b.w
    addTri(a0x, a0y, b0x, b0y, a1x, a1y)
    addTri(b0x, b0y, b1x, b1y, a1x, a1y)
  }

  // Miter (or bevel) fill at each interior vertex to close the outer wedge.
  for (let i = 1; i < n - 1; i++) {
    const p = points[i]
    let pdx = p.x - points[i - 1].x
    let pdy = p.y - points[i - 1].y
    let l = Math.hypot(pdx, pdy)
    if (l < 1e-9) continue
    pdx /= l
    pdy /= l
    let ndx = points[i + 1].x - p.x
    let ndy = points[i + 1].y - p.y
    l = Math.hypot(ndx, ndy)
    if (l < 1e-9) continue
    ndx /= l
    ndy /= l

    const cross = pdx * ndy - pdy * ndx
    if (Math.abs(cross) < 1e-4) continue // collinear — segments already align
    const hw = p.w
    const sign = cross > 0 ? -1 : 1 // outward normal sign

    const npx = -pdy * sign
    const npy = pdx * sign
    const nnx = -ndy * sign
    const nny = ndx * sign
    const oPx = p.x + npx * hw
    const oPy = p.y + npy * hw
    const oNx = p.x + nnx * hw
    const oNy = p.y + nny * hw

    let mx = npx + nnx
    let my = npy + nny
    const ml = Math.hypot(mx, my)
    if (ml < 1e-6) {
      addTri(p.x, p.y, oPx, oPy, oNx, oNy) // ~180° reversal → bevel
      continue
    }
    mx /= ml
    my /= ml
    const cosHalf = mx * npx + my * npy
    const miterLen = cosHalf > 1e-3 ? hw / cosHalf : hw * POLYLINE_MITER_LIMIT

    if (miterLen > hw * POLYLINE_MITER_LIMIT) {
      addTri(p.x, p.y, oPx, oPy, oNx, oNy) // bevel
    } else {
      const mPx = p.x + mx * miterLen
      const mPy = p.y + my * miterLen
      addTri(p.x, p.y, oPx, oPy, mPx, mPy)
      addTri(p.x, p.y, mPx, mPy, oNx, oNy)
    }
  }

  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}
