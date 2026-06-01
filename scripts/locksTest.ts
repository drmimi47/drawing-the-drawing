/**
 * Cluster H: lock influence as an INTERIOR distance field (1.0 deep in the core,
 * fading to 0 at the boundary, 0 outside). Run: npx tsx scripts/locksTest.ts
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
check('distance to boundary (interior)', Math.abs(distanceToPolygonBoundary(10, 50, square) - 10) < 1e-6)

check('deep core is hard locked (1.0)', lockInfluenceAt(50, 50, [lock]) === 1)
check('interior at half feather ~0.5', Math.abs(lockInfluenceAt(10, 50, [lock]) - 0.5) < 1e-6, `${lockInfluenceAt(10, 50, [lock])}`)
check('near boundary is small', lockInfluenceAt(1, 50, [lock]) > 0 && lockInfluenceAt(1, 50, [lock]) < 0.1)
check('outside is 0 (free)', lockInfluenceAt(110, 50, [lock]) === 0)
check('far outside is 0', lockInfluenceAt(500, 500, [lock]) === 0)

// Overlap takes the max: a big lock covers (5,50) deeply.
{
  const big: LockPolygon = {
    id: 'big',
    points: [
      { x: -100, y: -100 },
      { x: 100, y: -100 },
      { x: 100, y: 100 },
      { x: -100, y: 100 },
    ],
    featherRadius: 20,
  }
  check('lock alone gives partial at (5,50)', Math.abs(lockInfluenceAt(5, 50, [lock]) - 0.25) < 1e-6)
  check('overlap takes the max', lockInfluenceAt(5, 50, [lock, big]) === 1)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
