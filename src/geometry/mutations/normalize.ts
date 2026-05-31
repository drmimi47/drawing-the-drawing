/**
 * Normalization mode (Cluster F) — primitive fitting.
 *
 * A whole stroke is classified and fitted to a cleaner geometric primitive, then
 * morphed toward it:
 *   - open stroke              → best-fit straight line (snaps to exact H/V when close)
 *   - closed + round + dense   → fitted circle
 *   - closed with 3 corners    → clean triangle
 *   - closed with 4 corners    → fitted rectangle (right angles, sketch orientation)
 *   - other closed             → left alone (ellipse / general polygon are future work)
 *
 * `normalizeStroke` returns target positions aligned 1:1 with the input points
 * (or null when there's nothing confident to do). The caller morphs from the
 * original points toward these targets over time-outside.
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
const MIN_CIRCLE_POINTS = 8 // need enough samples to trust a circle (vs. a polygon)
const CORNER_EPS_FRAC = 0.05 // corner-detection tolerance as a fraction of bbox diagonal

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function angleDelta(target: number, current: number): number {
  let d = target - current
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

/** Perpendicular distance from p to the line through a and b. */
function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return dist(p, a)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function bboxDiagonal(points: Pt[]): number {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return Math.hypot(maxX - minX, maxY - minY)
}

// ---------------------------------------------------------------------------
// Line
// ---------------------------------------------------------------------------

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

  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  let dx = Math.cos(theta)
  let dy = Math.sin(theta)

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

// ---------------------------------------------------------------------------
// Circle
// ---------------------------------------------------------------------------

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

function circleTargets(points: Pt[], c: Circle): Pt[] {
  return points.map((p) => {
    const a = Math.atan2(p.y - c.cy, p.x - c.cx)
    return { x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) }
  })
}

// ---------------------------------------------------------------------------
// Polygons (triangle / rectangle)
// ---------------------------------------------------------------------------

/** RDP that returns the kept indices (always includes endpoints). */
function rdpIndices(pts: Pt[], eps: number): number[] {
  const n = pts.length
  if (n <= 2) return pts.map((_, i) => i)
  const keep = new Array<boolean>(n).fill(false)
  keep[0] = true
  keep[n - 1] = true
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let maxD = 0
    let idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > eps && idx >= 0) {
      keep[idx] = true
      stack.push([s, idx])
      stack.push([idx, e])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}

/** Detect dominant corners of a closed loop; returns sorted original indices. */
function detectCorners(loop: Pt[], eps: number): number[] {
  const m = loop.length
  if (m < 3) return loop.map((_, i) => i)

  let cx = 0
  let cy = 0
  for (const p of loop) {
    cx += p.x
    cy += p.y
  }
  cx /= m
  cy /= m

  let anchor = 0
  let best = -1
  for (let i = 0; i < m; i++) {
    const d = (loop[i].x - cx) ** 2 + (loop[i].y - cy) ** 2
    if (d > best) {
      best = d
      anchor = i
    }
  }

  // Rotate to start at the anchor, then close the loop so RDP can run open.
  const rot: Pt[] = []
  const ridx: number[] = []
  for (let k = 0; k < m; k++) {
    const o = (anchor + k) % m
    rot.push(loop[o])
    ridx.push(o)
  }
  rot.push(loop[anchor])

  const kept = rdpIndices(rot, eps)
  const corners = kept.filter((k) => k < m).map((k) => ridx[k])
  return [...new Set(corners)].sort((a, b) => a - b)
}

/** Fit a right-angled rectangle to a 4-corner loop; orientation from its edges. */
function fitRectangle(loop: Pt[], cornerIdx: number[]): Pt[] | null {
  if (cornerIdx.length !== 4) return null
  const c = cornerIdx.map((i) => loop[i])

  // Average edge orientation modulo 90° (period π/2 → use the 4× angle trick).
  let sx = 0
  let sy = 0
  for (let j = 0; j < 4; j++) {
    const a = c[j]
    const b = c[(j + 1) % 4]
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    sx += Math.cos(4 * ang)
    sy += Math.sin(4 * ang)
  }
  const theta = Math.atan2(sy, sx) / 4
  const ux = Math.cos(theta)
  const uy = Math.sin(theta)
  const vx = -uy
  const vy = ux

  // Oriented bounding box over the whole loop.
  let umin = Infinity
  let umax = -Infinity
  let vmin = Infinity
  let vmax = -Infinity
  for (const p of loop) {
    const pu = p.x * ux + p.y * uy
    const pv = p.x * vx + p.y * vy
    if (pu < umin) umin = pu
    if (pu > umax) umax = pu
    if (pv < vmin) vmin = pv
    if (pv > vmax) vmax = pv
  }
  const umid = (umin + umax) / 2
  const vmid = (vmin + vmax) / 2
  const toWorld = (pu: number, pv: number): Pt => ({ x: ux * pu + vx * pv, y: uy * pu + vy * pv })

  // Snap each detected corner to its nearest rectangle corner, preserving order.
  const targets: Pt[] = []
  const used = new Set<string>()
  for (const corner of c) {
    const pu = corner.x * ux + corner.y * uy
    const pv = corner.x * vx + corner.y * vy
    const su = pu < umid ? umin : umax
    const sv = pv < vmid ? vmin : vmax
    targets.push(toWorld(su, sv))
    used.add(`${su === umin ? 0 : 1}${sv === vmin ? 0 : 1}`)
  }
  return used.size === 4 ? targets : null
}

/**
 * Morph each loop point onto the target polygon: points slide along the cleaned
 * edges (by arc-length fraction between corners), so corners snap to corners.
 */
function polygonTargets(loop: Pt[], cornerIdx: number[], cornerPos: Pt[]): Pt[] {
  const m = loop.length
  const cum = new Array<number>(m)
  cum[0] = 0
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + dist(loop[i - 1], loop[i])
  const perim = cum[m - 1] + dist(loop[m - 1], loop[0])
  if (perim < 1e-6) return loop.map((p) => ({ x: p.x, y: p.y }))

  const k = cornerIdx.length
  const gf = cornerIdx.map((idx) => cum[idx] / perim)

  const out: Pt[] = new Array(m)
  for (let i = 0; i < m; i++) {
    let f = cum[i] / perim
    if (f < gf[0]) f += 1
    let j = k - 1
    for (let s = 0; s < k; s++) {
      const hi = s + 1 < k ? gf[s + 1] : gf[0] + 1
      if (f >= gf[s] && f < hi) {
        j = s
        break
      }
    }
    const lo = gf[j]
    const hi = j + 1 < k ? gf[j + 1] : gf[0] + 1
    const frac = hi > lo ? (f - lo) / (hi - lo) : 0
    const a = cornerPos[j]
    const b = cornerPos[(j + 1) % k]
    out[i] = { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac }
  }
  return out
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export function normalizeStroke(points: Pt[]): Pt[] | null {
  const n = points.length
  if (n < 2) return null

  const hasDup = dist(points[0], points[n - 1]) < 1e-6
  const loop = hasDup ? points.slice(0, n - 1) : points
  const m = loop.length
  if (m < 2) return null

  let perimeter = 0
  for (let i = 1; i < m; i++) perimeter += dist(loop[i - 1], loop[i])
  const totalClosed = perimeter + dist(loop[m - 1], loop[0])
  if (totalClosed < 4) return null

  const closed = m >= 4 && dist(points[0], points[n - 1]) < CLOSE_GAP_FRAC * totalClosed
  if (!closed) {
    return lineTargets(points)
  }

  const pad = (t: Pt[]): Pt[] => (hasDup ? [...t, { x: t[0].x, y: t[0].y }] : t)

  // Circle first (only when well-sampled and round).
  if (m >= MIN_CIRCLE_POINTS) {
    const circle = fitCircle(loop)
    if (circle && circle.residual < CIRCLE_RESIDUAL_MAX) return pad(circleTargets(loop, circle))
  }

  // Polygon: triangle or rectangle.
  const diag = bboxDiagonal(loop)
  if (diag < 1e-6) return null
  const corners = detectCorners(loop, CORNER_EPS_FRAC * diag)

  let cornerPos: Pt[] | null = null
  if (corners.length === 3) cornerPos = corners.map((i) => ({ x: loop[i].x, y: loop[i].y }))
  else if (corners.length === 4) cornerPos = fitRectangle(loop, corners)
  if (!cornerPos) return null

  return pad(polygonTargets(loop, corners, cornerPos))
}
