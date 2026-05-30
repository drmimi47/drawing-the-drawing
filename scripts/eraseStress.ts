/**
 * Stress test for the eraser: simulate extremely fast cursor movement (large
 * gaps between samples) and assert that NO surviving geometry lies inside the
 * swept eraser path. Run with: npx tsx scripts/eraseStress.ts
 */
import { eraseStrokesCapsule } from '../src/geometry/erase'
import type { Stroke } from '../src/store/drawingStore'

type Pt = { x: number; y: number }

function distSqPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = ax + t * dx
  const cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}

/** Min distance from a point to the eraser path (polyline). */
function distToPath(px: number, py: number, path: Pt[]): number {
  let best = Infinity
  for (let i = 1; i < path.length; i++) {
    const d = distSqPointSegment(px, py, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y)
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

function stroke(points: [number, number][]): Stroke {
  return {
    id: 'init-' + Math.random().toString(36).slice(2),
    color: '#000',
    points: points.map(([x, y]) => ({ x, y, w: 1.75 })),
  }
}

/** Densely sample every surviving stroke segment. */
function sampleSurvivors(strokes: Stroke[], spacing: number): Pt[] {
  const out: Pt[] = []
  for (const s of strokes) {
    for (let i = 0; i < s.points.length - 1; i++) {
      const a = s.points[i]
      const b = s.points[i + 1]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const n = Math.max(1, Math.ceil(len / spacing))
      for (let k = 0; k <= n; k++) {
        const t = k / n
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      }
    }
  }
  return out
}

let failures = 0

function runScenario(name: string, initial: Stroke[], path: Pt[], r: number) {
  let strokes = initial
  for (let i = 1; i < path.length; i++) {
    strokes = eraseStrokesCapsule(strokes, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y, r)
  }

  // A survivor sample deeper than this far inside the eraser path is a fragment
  // that should have been erased.
  const tolerance = 0.75
  let worstDepth = 0
  let worstPt: Pt | null = null
  for (const p of sampleSurvivors(strokes, 0.5)) {
    const d = distToPath(p.x, p.y, path)
    const depth = r - d
    if (depth > tolerance && depth > worstDepth) {
      worstDepth = depth
      worstPt = p
    }
  }

  if (worstPt) {
    failures++
    console.log(
      `FAIL  ${name}: fragment at (${worstPt.x.toFixed(1)}, ${worstPt.y.toFixed(1)}) is ${worstDepth.toFixed(
        1,
      )}px inside the eraser path (r=${r}). Survivors: ${strokes.length}`,
    )
  } else {
    console.log(`PASS  ${name} (survivors: ${strokes.length})`)
  }
}

const R = 14

// 1. The smoking gun: erase the END of a 2-point straight line.
runScenario('trim end of straight line', [stroke([[0, 0], [1000, 0]])], [
  { x: 950, y: 0 },
  { x: 1050, y: 0 },
], R)

// 2. Erase the START of a straight line.
runScenario('trim start of straight line', [stroke([[0, 0], [1000, 0]])], [
  { x: -50, y: 0 },
  { x: 60, y: 0 },
], R)

// 3. Fast swipe ALONG a straight line in huge steps (simulates coalesced flick).
runScenario(
  'fast swipe along line',
  [stroke([[0, 0], [2000, 0]])],
  [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 900, y: 0 },
    { x: 1500, y: 0 },
    { x: 2000, y: 0 },
  ],
  R,
)

// 4. Fast diagonal flick across a dense vertical grid of straight lines.
{
  const grid: Stroke[] = []
  for (let x = 0; x <= 1000; x += 25) grid.push(stroke([[x, -300], [x, 300]]))
  runScenario('fast flick across grid', grid, [
    { x: -50, y: -250 },
    { x: 1100, y: 250 },
  ], R)
}

// 5. Many-point zigzag, scrubbed with large random jumps.
{
  const zig: [number, number][] = []
  for (let i = 0; i <= 200; i++) zig.push([i * 5, i % 2 === 0 ? 0 : 40])
  const path: Pt[] = []
  for (let i = 0; i <= 20; i++) path.push({ x: i * 50, y: 20 })
  runScenario('scrub zigzag', [stroke(zig)], path, R)
}

// 6. Randomized fuzz: random strokes erased by random ultra-fast paths (huge
//    jumps of up to ~1500px per step), repeated many times.
{
  let rngState = 123456789
  const rand = () => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
    return rngState / 0x7fffffff
  }
  const span = 1000
  for (let trial = 0; trial < 300; trial++) {
    const strokes: Stroke[] = []
    const strokeCount = 1 + Math.floor(rand() * 6)
    for (let s = 0; s < strokeCount; s++) {
      const pts: [number, number][] = []
      const segs = 1 + Math.floor(rand() * 8)
      for (let k = 0; k <= segs; k++) pts.push([rand() * span, rand() * span])
      strokes.push(stroke(pts))
    }
    const path: Pt[] = []
    const steps = 2 + Math.floor(rand() * 6)
    for (let k = 0; k < steps; k++) path.push({ x: rand() * span, y: rand() * span })
    runScenario(`fuzz #${trial}`, strokes, path, R)
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
