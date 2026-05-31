/**
 * Cluster H verification: lock influence (hard inside, feathered falloff outside).
 * Run: npx tsx scripts/locksTest.ts
 */
import { lockInfluenceAt, pointInPolygon, distanceToPolygonBoundary } from '../src/geometry/locks'
import type { LockPolygon } from '../src/types/geometry'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`PASS  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]
const lock: LockPolygon = { id: 'l', points: square, featherRadius: 20 }

check('point inside polygon', pointInPolygon(50, 50, square))
check('point outside polygon', !pointInPolygon(150, 50, square))
check('distance to boundary (outside)', Math.abs(distanceToPolygonBoundary(110, 50, square) - 10) < 1e-6,
  `${distanceToPolygonBoundary(110, 50, square)}`)

check('influence 1.0 inside', lockInfluenceAt(50, 50, [lock]) === 1)
check('influence 0 far outside', lockInfluenceAt(200, 50, [lock]) === 0)

// 10px outside a 20px feather → halfway → influence ~0.5.
{
  const inf = lockInfluenceAt(110, 50, [lock])
  check('feather falloff ~0.5 at half radius', Math.abs(inf - 0.5) < 1e-6, `${inf}`)
}
// Just inside the feather edge (19px out) → small positive.
{
  const inf = lockInfluenceAt(119, 50, [lock])
  check('feather near edge is small positive', inf > 0 && inf < 0.1, `${inf}`)
}
// Two overlapping locks take the max.
{
  const lock2: LockPolygon = {
    id: 'l2',
    points: [
      { x: 105, y: 40 },
      { x: 140, y: 40 },
      { x: 140, y: 60 },
      { x: 105, y: 60 },
    ],
    featherRadius: 20,
  }
  // Point (110,50) is inside lock2 → influence 1 despite being feathered for lock1.
  check('overlapping locks take max', lockInfluenceAt(110, 50, [lock, lock2]) === 1)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
