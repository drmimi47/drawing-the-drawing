/**
 * Normalization mode (Cluster F, reworked) — primitive fitting.
 *
 * Instead of nudging individual edge angles, a whole stroke is classified and
 * fitted to a cleaner geometric primitive, then morphed toward it:
 *   - open stroke   → best-fit straight line (snaps to exact horizontal/vertical
 *                     when the fit is close enough)
 *   - closed + round → fitted circle
 *   - other closed   → left alone for now (polygon/ellipse fitting is future work)
 *
 * `normalizeStroke` returns target positions aligned 1:1 with the input points
 * (or null when there's nothing confident to do). The caller morphs from the
 * original points toward these targets over time-outside, so the change is a
 * gradual morph rather than an on/off snap.
 */

/** How long (ms) unobserved to reach a full (100%) morph. Tunable. */
export const DECAY_MAX_MS = 5000

export interface Pt {
  x: number
  y: number
}

const HV_SNAP_RAD = (8 * Math.PI) / 180 // snap to H/V within 8°
const CIRCLE_RESIDUAL_MAX = 0.18 // max RMS radial error / R to accept a circle
const CLOSE_GAP_FRAC = 0.2 // endpoints within 20% of perimeter ⇒ "closed"
// A few corner points (triangle/square/...) are concyclic, so circle-fitting
// them looks "perfect". Require enough samples to trust a circle — real
// freehand circles keep many points after simplification; polygons reduce to a
// handful of corners and are left alone (future polygon/ellipse work).
const MIN_CIRCLE_POINTS = 8

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function angleDelta(target: number, current: number): number {
  let d = target - current
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

/** Best-fit straight line via PCA; snaps to exact H/V when close. */
function lineTargets(points: Pt[]): Pt[] {
  const n = points.length
  let mx = 0
  let my = 0
  for (const p of points) {
    mx += p.x
    my += p.y
  }
  mx /= n
  my /= n

  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of points) {
    const dx = p.x - mx
    const dy = p.y - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }

  // Principal axis of the point cloud.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  let dx = Math.cos(theta)
  let dy = Math.sin(theta)

  // Project onto the axis to find the segment extents.
  let tmin = Infinity
  let tmax = -Infinity
  for (const p of points) {
    const t = (p.x - mx) * dx + (p.y - my) * dy
    if (t < tmin) tmin = t
    if (t > tmax) tmax = t
  }
  let ax = mx + dx * tmin
  let ay = my + dy * tmin
  let bx = mx + dx * tmax
  let by = my + dy * tmax

  // Snap to exact horizontal/vertical when the angle is close.
  const angle = Math.atan2(by - ay, bx - ax)
  const nearest90 = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2)
  if (Math.abs(angleDelta(nearest90, angle)) < HV_SNAP_RAD) {
    const cx = (ax + bx) / 2
    const cy = (ay + by) / 2
    const len = Math.hypot(bx - ax, by - ay)
    dx = Math.cos(nearest90)
    dy = Math.sin(nearest90)
    ax = cx - (dx * len) / 2
    ay = cy - (dy * len) / 2
    bx = cx + (dx * len) / 2
    by = cy + (dy * len) / 2
  }

  const targets: Pt[] = []
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1)
    targets.push({ x: ax + (bx - ax) * f, y: ay + (by - ay) * f })
  }
  return targets
}

/** Solve a 3×3 linear system (Gaussian elimination with partial pivoting). */
function solve3(m: number[][], v: number[]): number[] | null {
  const a = m.map((row, i) => [...row, v[i]])
  for (let i = 0; i < 3; i++) {
    let pivot = i
    for (let r = i + 1; r < 3; r++) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r
    if (Math.abs(a[pivot][i]) < 1e-12) return null
    ;[a[i], a[pivot]] = [a[pivot], a[i]]
    for (let r = 0; r < 3; r++) {
      if (r === i) continue
      const f = a[r][i] / a[i][i]
      for (let c = i; c < 4; c++) a[r][c] -= f * a[i][c]
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]]
}

interface Circle {
  cx: number
  cy: number
  r: number
  residual: number
}

/** Algebraic (Kåsa) circle fit. */
function fitCircle(points: Pt[]): Circle | null {
  let Sx = 0
  let Sy = 0
  let Sxx = 0
  let Syy = 0
  let Sxy = 0
  let Sxz = 0
  let Syz = 0
  let Sz = 0
  const n = points.length
  for (const p of points) {
    const z = p.x * p.x + p.y * p.y
    Sx += p.x
    Sy += p.y
    Sxx += p.x * p.x
    Syy += p.y * p.y
    Sxy += p.x * p.y
    Sxz += p.x * z
    Syz += p.y * z
    Sz += z
  }
  const sol = solve3(
    [
      [Sxx, Sxy, Sx],
      [Sxy, Syy, Sy],
      [Sx, Sy, n],
    ],
    [Sxz, Syz, Sz],
  )
  if (!sol) return null
  const [A, B, C] = sol
  const cx = A / 2
  const cy = B / 2
  const r = Math.sqrt(Math.max(0, C + cx * cx + cy * cy))
  if (!isFinite(r) || r < 1e-3) return null

  let s = 0
  for (const p of points) {
    const d = Math.hypot(p.x - cx, p.y - cy) - r
    s += d * d
  }
  return { cx, cy, r, residual: Math.sqrt(s / n) / r }
}

/** Project each point radially onto the fitted circle (keeps angular order). */
function circleTargets(points: Pt[], c: Circle): Pt[] {
  return points.map((p) => {
    const a = Math.atan2(p.y - c.cy, p.x - c.cx)
    return { x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) }
  })
}

/**
 * Classify a stroke and return target positions for its points, or null if there
 * is nothing confident to normalize toward.
 */
export function normalizeStroke(points: Pt[]): Pt[] | null {
  const n = points.length
  if (n < 2) return null

  let perimeter = 0
  for (let i = 1; i < n; i++) perimeter += dist(points[i - 1], points[i])
  if (perimeter < 4) return null // too tiny to bother

  const closed = n >= 4 && dist(points[0], points[n - 1]) < CLOSE_GAP_FRAC * perimeter
  if (closed) {
    if (n >= MIN_CIRCLE_POINTS) {
      const circle = fitCircle(points)
      if (circle && circle.residual < CIRCLE_RESIDUAL_MAX) return circleTargets(points, circle)
    }
    return null // closed but not a round, well-sampled circle — leave it alone
  }

  return lineTargets(points)
}
