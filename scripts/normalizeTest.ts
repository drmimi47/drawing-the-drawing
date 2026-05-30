/**
 * Cluster F verification: Normalization snaps an edge's angle toward the nearest
 * 15° increment, scaled by magnitude, and honors anchored (observed) endpoints.
 * Run: npx tsx scripts/normalizeTest.ts
 */
import { computeNormalizationTargets, type ReentryEvent } from '../src/geometry/mutations/normalize'
import type { Graph } from '../src/types/geometry'

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`PASS  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const deg = (r: number) => (r * 180) / Math.PI

/** Build a one-edge graph from a to b. */
function makeGraph(ax: number, ay: number, bx: number, by: number): Graph {
  return {
    vertices: {
      a: { id: 'a', x: ax, y: ay },
      b: { id: 'b', x: bx, y: by },
    },
    strokes: [{ id: 's', color: '#000', path: [{ v: 'a', w: 1 }, { v: 'b', w: 1 }] }],
  }
}

function angleOf(p: { x: number; y: number }, q: { x: number; y: number }) {
  return Math.atan2(q.y - p.y, q.x - p.x)
}

const ev: ReentryEvent[] = [{ v0: 'a', v1: 'b', magnitude: 1 }]

// A line ~5° off horizontal, full magnitude → should snap to ~0°.
{
  const g = makeGraph(0, 0, 100, Math.tan((5 * Math.PI) / 180) * 100)
  const targets = computeNormalizationTargets(g, ev, () => true)
  const a = targets['a'] ?? g.vertices.a
  const b = targets['b'] ?? g.vertices.b
  const ang = Math.abs(deg(angleOf(a, b)))
  check('5° line snaps toward 0°', ang < 0.5, `got ${ang.toFixed(2)}°`)
}

// A line ~20° (near 15° increment) → should snap to ~15°.
{
  const g = makeGraph(0, 0, 100, Math.tan((20 * Math.PI) / 180) * 100)
  const targets = computeNormalizationTargets(g, ev, () => true)
  const a = targets['a'] ?? g.vertices.a
  const b = targets['b'] ?? g.vertices.b
  const ang = deg(angleOf(a, b))
  check('20° line snaps toward 15°', Math.abs(ang - 15) < 0.5, `got ${ang.toFixed(2)}°`)
}

// Half magnitude on a 6° line → should move halfway toward 0° (~3°).
{
  const g = makeGraph(0, 0, 100, Math.tan((6 * Math.PI) / 180) * 100)
  const targets = computeNormalizationTargets(g, [{ v0: 'a', v1: 'b', magnitude: 0.5 }], () => true)
  const a = targets['a'] ?? g.vertices.a
  const b = targets['b'] ?? g.vertices.b
  const ang = Math.abs(deg(angleOf(a, b)))
  check('half magnitude moves halfway (~3°)', Math.abs(ang - 3) < 0.5, `got ${ang.toFixed(2)}°`)
}

// Anchored endpoint: 'a' is observed (not mutable) → a stays put, b swings.
{
  const g = makeGraph(0, 0, 100, Math.tan((5 * Math.PI) / 180) * 100)
  const targets = computeNormalizationTargets(g, ev, (id) => id === 'b')
  check('anchored endpoint a is not moved', targets['a'] === undefined)
  const a = g.vertices.a
  const b = targets['b'] ?? g.vertices.b
  const ang = Math.abs(deg(angleOf(a, b)))
  check('swinging about anchor still snaps to ~0°', ang < 0.5, `got ${ang.toFixed(2)}°`)
}

// Length is preserved by the rotation (about midpoint).
{
  const g = makeGraph(0, 0, 100, Math.tan((5 * Math.PI) / 180) * 100)
  const origLen = Math.hypot(g.vertices.b.x - g.vertices.a.x, g.vertices.b.y - g.vertices.a.y)
  const targets = computeNormalizationTargets(g, ev, () => true)
  const a = targets['a']!
  const b = targets['b']!
  const newLen = Math.hypot(b.x - a.x, b.y - a.y)
  check('edge length preserved', Math.abs(newLen - origLen) < 1e-6, `${origLen} vs ${newLen}`)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
