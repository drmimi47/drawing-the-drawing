/**
 * Cluster D verification: crossing two strokes must insert a single SHARED
 * vertex referenced by both strokes' paths. Run: npx tsx scripts/graphTest.ts
 */
import { addStrokeToGraph, deriveEdges, resolveStrokePoints } from '../src/geometry/graph'
import { emptyGraph, type SamplePoint } from '../src/types/geometry'

function pts(coords: [number, number][]): SamplePoint[] {
  return coords.map(([x, y]) => ({ x, y, w: 1.75 }))
}

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`PASS  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// Two strokes crossing at (0,0): a horizontal and a vertical line.
let g = emptyGraph()
g = addStrokeToGraph(g, pts([[-100, 0], [100, 0]]), '#000')
g = addStrokeToGraph(g, pts([[0, -100], [0, 100]]), '#000')

check('two strokes exist', g.strokes.length === 2)

// Each stroke should now pass through the intersection: 3 path points each.
const [h, v] = g.strokes
check('horizontal split into 3 path points', h.path.length === 3, `got ${h.path.length}`)
check('vertical split into 3 path points', v.path.length === 3, `got ${v.path.length}`)

// The middle vertex of each must be the SAME shared vertex id.
const sharedH = h.path[1].v
const sharedV = v.path[1].v
check('crossing produces a shared vertex', sharedH === sharedV, `${sharedH} vs ${sharedV}`)

// The shared vertex sits at the crossing point (0,0).
const sv = g.vertices[sharedH]
check('shared vertex at crossing', Math.abs(sv.x) < 1e-6 && Math.abs(sv.y) < 1e-6, `(${sv.x}, ${sv.y})`)

// Edge count: each 3-point stroke yields 2 edges → 4 total.
check('derived edges = 4', deriveEdges(g).length === 4, `got ${deriveEdges(g).length}`)

// Resolved geometry still spans the original extents.
const hp = resolveStrokePoints(g, h)
check('horizontal endpoints preserved', hp[0].x === -100 && hp[hp.length - 1].x === 100)

// Non-crossing stroke should not be split.
let g2 = emptyGraph()
g2 = addStrokeToGraph(g2, pts([[0, 0], [50, 0]]), '#000')
g2 = addStrokeToGraph(g2, pts([[0, 50], [50, 50]]), '#000')
check('parallel strokes are not split', g2.strokes.every((s) => s.path.length === 2))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
