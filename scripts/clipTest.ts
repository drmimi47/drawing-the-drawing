/**
 * Cluster H: partial selection segmentation — clip a polyline against a polygon
 * region and split crossing strokes. Run: npx tsx scripts/clipTest.ts
 */
import { clipPolylineByPolygon, segmentStrokesByPolygon } from '../src/geometry/clip'
import { addStrokeToGraph } from '../src/geometry/graph'
import { emptyGraph, type SamplePoint } from '../src/types/geometry'

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
const pts = (coords: [number, number][]): SamplePoint[] => coords.map(([x, y]) => ({ x, y, w: 1.75 }))

// A horizontal line crossing the square left→right → outside / inside / outside.
{
  const runs = clipPolylineByPolygon(pts([[-50, 50], [150, 50]]), square)
  check('crossing line yields 3 runs', runs.length === 3, `got ${runs.length}`)
  check('run classes are out/in/out', !runs[0].inside && runs[1].inside && !runs[2].inside)
  // Boundary points land on the square edges (x = 0 and x = 100).
  const a = runs[1].points[0].x
  const b = runs[1].points[runs[1].points.length - 1].x
  check('inside run spans the boundary', Math.abs(a - 0) < 1e-6 && Math.abs(b - 100) < 1e-6, `${a}..${b}`)
}

// Fully inside → one inside run; fully outside → one outside run.
check('fully inside → 1 inside run', (() => {
  const r = clipPolylineByPolygon(pts([[20, 50], [80, 50]]), square)
  return r.length === 1 && r[0].inside
})())
check('fully outside → 1 outside run', (() => {
  const r = clipPolylineByPolygon(pts([[200, 50], [300, 50]]), square)
  return r.length === 1 && !r[0].inside
})())

// segmentStrokesByPolygon splits a crossing stroke into 3 strokes, 1 inside.
{
  let g = emptyGraph()
  g = addStrokeToGraph(g, pts([[-50, 50], [150, 50]]), '#000')
  const { graph, insideStrokeIds, changed } = segmentStrokesByPolygon(g, square)
  check('segmentation reports changed', changed)
  check('stroke split into 3', graph.strokes.length === 3, `got ${graph.strokes.length}`)
  check('exactly 1 inside piece', insideStrokeIds.length === 1, `got ${insideStrokeIds.length}`)
}

// A non-crossing stroke is left intact.
{
  let g = emptyGraph()
  g = addStrokeToGraph(g, pts([[20, 50], [80, 50]]), '#000')
  const { graph, insideStrokeIds, changed } = segmentStrokesByPolygon(g, square)
  check('non-crossing stroke not changed', !changed && graph.strokes.length === 1)
  check('fully-inside stroke is selected', insideStrokeIds.length === 1)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
