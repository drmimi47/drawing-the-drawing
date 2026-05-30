/**
 * Cluster E verification: observation-boundary geometry helpers.
 * Run: npx tsx scripts/observerTest.ts
 */
import { insetAABB, segmentIntersectsAABB, type ViewportAABB } from '../src/utils/viewport'

let failures = 0
function check(name: string, condition: boolean) {
  if (condition) console.log(`PASS  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}`)
  }
}

const box: ViewportAABB = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

// insetAABB
const inset = insetAABB(box, 10)
check('inset shrinks each side', inset.minX === 10 && inset.maxX === 90 && inset.minY === 10 && inset.maxY === 90)
check('inset does not invert when too large', insetAABB(box, 1000) === box)

// segmentIntersectsAABB
check('segment fully inside intersects', segmentIntersectsAABB(20, 20, 80, 80, box))
check('segment crossing through intersects', segmentIntersectsAABB(-50, 50, 150, 50, box))
check('segment fully outside (right) does not', !segmentIntersectsAABB(200, 50, 300, 50, box))
check('segment fully outside (above) does not', !segmentIntersectsAABB(50, 200, 60, 250, box))
check('segment skimming past a corner does not', !segmentIntersectsAABB(120, 90, 90, 120, box))
check('segment entering one edge intersects', segmentIntersectsAABB(50, 50, 200, 50, box))
check('degenerate point inside intersects', segmentIntersectsAABB(50, 50, 50, 50, box))
check('degenerate point outside does not', !segmentIntersectsAABB(200, 200, 200, 200, box))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
