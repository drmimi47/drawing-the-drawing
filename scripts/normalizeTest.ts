/**
 * Cluster F verification: stroke → primitive fitting.
 *   - open near-horizontal line snaps to exact horizontal
 *   - open slanted line becomes a straight (collinear) segment at its angle
 *   - closed round stroke fits a circle (equal radii)
 *   - closed square is left alone (not a supported primitive yet)
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

// 1. Rough near-horizontal line → snapped to exact horizontal (all y equal).
{
  const pts: Pt[] = [
    { x: 0, y: 0 },
    { x: 25, y: 2 },
    { x: 50, y: -1.5 },
    { x: 75, y: 1 },
    { x: 100, y: -0.5 },
  ]
  const t = normalizeStroke(pts)!
  const ys = t.map((p) => p.y)
  const spread = Math.max(...ys) - Math.min(...ys)
  check('near-horizontal snaps to exact horizontal', t !== null && spread < 1e-6, `y spread ${spread}`)
}

// 2. Clean 30° open line → stays straight at ~30°.
{
  const k = Math.tan((30 * Math.PI) / 180)
  const pts: Pt[] = [0, 20, 40, 60, 80].map((x) => ({ x, y: k * x }))
  const t = normalizeStroke(pts)!
  const ang = deg(Math.atan2(t[t.length - 1].y - t[0].y, t[t.length - 1].x - t[0].x))
  // collinearity: cross product of (t1-t0) and (t2-t0) ≈ 0
  const cross =
    (t[2].x - t[0].x) * (t[4].y - t[0].y) - (t[2].y - t[0].y) * (t[4].x - t[0].x)
  check('30° line stays ~30°', Math.abs(ang - 30) < 0.5, `got ${ang.toFixed(2)}°`)
  check('30° line becomes collinear', Math.abs(cross) < 1e-6, `cross ${cross}`)
}

// 3. Closed round stroke → fitted circle (equal radii about the centroid).
{
  const cx = 10
  const cy = 20
  const R = 50
  const pts: Pt[] = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) })
  }
  pts.push({ ...pts[0] }) // close it
  const t = normalizeStroke(pts)
  check('closed round stroke is fitted', t !== null)
  if (t) {
    // Exact circle input ⇒ fit recovers the true center; check radii about it.
    const radii = t.map((p) => Math.hypot(p.x - cx, p.y - cy))
    const spread = Math.max(...radii) - Math.min(...radii)
    check('fitted circle has equal radii', spread < 1e-3, `radius spread ${spread}`)
  }
}

// 4. Closed square → not a supported primitive yet → null (left alone).
{
  const pts: Pt[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 0, y: 0 },
  ]
  check('closed square is left alone', normalizeStroke(pts) === null)
}

// 5. Tiny stroke → null.
check('tiny stroke is left alone', normalizeStroke([{ x: 0, y: 0 }, { x: 1, y: 0 }]) === null)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
