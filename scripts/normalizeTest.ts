/**
 * Cluster F verification: stroke → primitive fitting (line, circle, triangle, rectangle).
 * Run: npx tsx scripts/normalizeTest.ts
 */
import { normalizeStroke, type Pt } from '../src/geometry/mutations/normalize'

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`PASS  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const deg = (r: number) => (r * 180) / Math.PI

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Min distance from p to the boundary of a closed polygon. */
function distToPolygon(p: Pt, corners: Pt[]): number {
  let best = Infinity
  for (let i = 0; i < corners.length; i++) {
    const d = segDist(p, corners[i], corners[(i + 1) % corners.length])
    if (d < best) best = d
  }
  return best
}

function rotate(p: Pt, ang: number): Pt {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

// 1. Rough near-horizontal line → snapped to exact horizontal.
{
  const pts: Pt[] = [
    { x: 0, y: 0 },
    { x: 25, y: 2 },
    { x: 50, y: -1.5 },
    { x: 75, y: 1 },
    { x: 100, y: -0.5 },
  ]
  const t = normalizeStroke(pts)!
  const spread = Math.max(...t.map((p) => p.y)) - Math.min(...t.map((p) => p.y))
  check('near-horizontal snaps to exact horizontal', t !== null && spread < 1e-6, `y spread ${spread}`)
}

// 2. Clean 30° open line → stays straight at ~30°.
{
  const k = Math.tan((30 * Math.PI) / 180)
  const pts: Pt[] = [0, 20, 40, 60, 80].map((x) => ({ x, y: k * x }))
  const t = normalizeStroke(pts)!
  const ang = deg(Math.atan2(t[t.length - 1].y - t[0].y, t[t.length - 1].x - t[0].x))
  check('30° line stays ~30°', Math.abs(ang - 30) < 0.5, `got ${ang.toFixed(2)}°`)
}

// 3. Closed round stroke → fitted circle.
{
  const cx = 10
  const cy = 20
  const R = 50
  const pts: Pt[] = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) })
  }
  pts.push({ ...pts[0] })
  const t = normalizeStroke(pts)!
  const radii = t.map((p) => Math.hypot(p.x - cx, p.y - cy))
  const spread = Math.max(...radii) - Math.min(...radii)
  check('closed round stroke → circle (equal radii)', t !== null && spread < 1e-3, `spread ${spread}`)
}

// 4. Triangle-like sketch (corners + collinear edge midpoints) → clean triangle.
{
  const A = { x: 0, y: 0 }
  const B = { x: 120, y: 0 }
  const C = { x: 60, y: 90 }
  const pts: Pt[] = [A, { x: 60, y: 0 }, B, { x: 90, y: 45 }, C, { x: 30, y: 45 }, { ...A }]
  const t = normalizeStroke(pts)
  check('triangle is fitted', t !== null)
  if (t) {
    const maxOff = Math.max(...t.map((p) => distToPolygon(p, [A, B, C])))
    check('triangle points lie on the 3 edges', maxOff < 1e-6, `max off ${maxOff}`)
  }
}

// 5. Rectangle-like sketch → fitted axis-aligned rectangle.
{
  const corners = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 80 },
    { x: 0, y: 80 },
  ]
  const pts: Pt[] = [
    corners[0], { x: 60, y: 0 },
    corners[1], { x: 120, y: 40 },
    corners[2], { x: 60, y: 80 },
    corners[3], { x: 0, y: 40 },
    { ...corners[0] },
  ]
  const t = normalizeStroke(pts)
  check('rectangle is fitted', t !== null)
  if (t) {
    const maxOff = Math.max(...t.map((p) => distToPolygon(p, corners)))
    check('rectangle points lie on the 4 edges', maxOff < 1e-6, `max off ${maxOff}`)
  }
}

// 6. Rotated rectangle (30°) → still a right-angled rectangle.
{
  const ang = (30 * Math.PI) / 180
  const base = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 80 },
    { x: 0, y: 80 },
  ]
  const raw: Pt[] = [
    base[0], { x: 60, y: 0 },
    base[1], { x: 120, y: 40 },
    base[2], { x: 60, y: 80 },
    base[3], { x: 0, y: 40 },
    { ...base[0] },
  ].map((p) => rotate(p, ang))
  const t = normalizeStroke(raw)
  check('rotated rectangle is fitted', t !== null)
  if (t) {
    const back = t.map((p) => rotate(p, -ang))
    const maxOff = Math.max(...back.map((p) => distToPolygon(p, base)))
    check('rotated rectangle un-rotates to axis rectangle', maxOff < 1e-6, `max off ${maxOff}`)
  }
}

// 7. Square → rectangle (now supported, no longer left alone).
{
  const corners = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]
  const pts: Pt[] = [...corners, { ...corners[0] }]
  const t = normalizeStroke(pts)
  check('square → rectangle', t !== null && Math.max(...t.map((p) => distToPolygon(p, corners))) < 1e-6)
}

// 8. Pentagon (5 corners) → left alone (only triangle/rectangle supported).
{
  const pts: Pt[] = []
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    pts.push({ x: 50 * Math.cos(a), y: 50 * Math.sin(a) })
  }
  pts.push({ ...pts[0] })
  check('pentagon is left alone', normalizeStroke(pts) === null)
}

// 9. Tiny stroke → null.
check('tiny stroke is left alone', normalizeStroke([{ x: 0, y: 0 }, { x: 1, y: 0 }]) === null)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
