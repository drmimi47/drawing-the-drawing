import type { Graph, PathPoint, SamplePoint, Stroke, Vertex } from '../types/geometry'
import { newId, resolveStrokePoints } from './graph'
import { pointInPolygon } from './locks'

/**
 * Polyline × polygon clipping (Cluster H — partial selection segmentation).
 *
 * Splits a stroke at a region boundary so only the enclosed portion is
 * selected/locked, giving finer control than whole-stroke selection.
 */

type Pt = { x: number; y: number }

export interface ClassifiedRun {
  points: SamplePoint[]
  inside: boolean
}

function lerpSample(p0: SamplePoint, p1: SamplePoint, t: number): SamplePoint {
  return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, w: p0.w + (p1.w - p0.w) * t }
}

/** Parameter t along p0→p1 where it crosses segment a-b (interior only), or null. */
function segmentCross(p0: Pt, p1: Pt, a: Pt, b: Pt): number | null {
  const rx = p1.x - p0.x
  const ry = p1.y - p0.y
  const sx = b.x - a.x
  const sy = b.y - a.y
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-12) return null
  const t = ((a.x - p0.x) * sy - (a.y - p0.y) * sx) / denom
  const u = ((a.x - p0.x) * ry - (a.y - p0.y) * rx) / denom
  const eps = 1e-7
  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) return t
  return null
}

/**
 * Split a polyline into runs alternating inside/outside the polygon. Boundary
 * crossing points are inserted and shared between adjacent runs.
 */
export function clipPolylineByPolygon(points: SamplePoint[], poly: Pt[]): ClassifiedRun[] {
  const n = points.length
  if (n < 2 || poly.length < 3) return []

  const runs: ClassifiedRun[] = []
  let current: SamplePoint[] = [{ ...points[0] }]
  let inside = pointInPolygon(points[0].x, points[0].y, poly)

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]

    const ts: number[] = []
    for (let e = 0; e < poly.length; e++) {
      const a = poly[e]
      const b = poly[(e + 1) % poly.length]
      const t = segmentCross(p0, p1, a, b)
      if (t !== null) ts.push(t)
    }
    ts.sort((x, y) => x - y)

    let last = -1
    for (const t of ts) {
      if (last >= 0 && Math.abs(t - last) < 1e-6) continue // dedupe (e.g. crossing a vertex)
      last = t
      const x = lerpSample(p0, p1, t)
      current.push(x)
      if (current.length >= 2) runs.push({ points: current, inside })
      current = [{ ...x }]
      inside = !inside
    }
    current.push({ ...p1 })
  }

  if (current.length >= 2) runs.push({ points: current, inside })
  return runs
}

/**
 * Segment every stroke that crosses the polygon into inside/outside sub-strokes
 * (fresh vertices). Strokes fully inside/outside are kept intact. Returns the new
 * graph (or the original when nothing crossed) and the ids of the inside pieces.
 */
export function segmentStrokesByPolygon(
  graph: Graph,
  poly: Pt[],
): { graph: Graph; insideStrokeIds: string[]; changed: boolean } {
  let changed = false
  const vertices: Record<string, Vertex> = {}
  const strokes: Stroke[] = []
  const insideStrokeIds: string[] = []

  for (const stroke of graph.strokes) {
    const pts = resolveStrokePoints(graph, stroke)
    const runs = clipPolylineByPolygon(pts, poly)

    if (runs.length <= 1) {
      // No crossing: keep the stroke and its vertices as-is.
      for (const pp of stroke.path) {
        const v = graph.vertices[pp.v]
        if (v) vertices[v.id] = v
      }
      strokes.push(stroke)
      if (runs.length === 1 && runs[0].inside) insideStrokeIds.push(stroke.id)
      continue
    }

    changed = true
    for (const run of runs) {
      if (run.points.length < 2) continue
      const path: PathPoint[] = run.points.map((sp) => {
        const id = newId('v')
        vertices[id] = { id, x: sp.x, y: sp.y }
        return { v: id, w: sp.w }
      })
      const id = newId('s')
      strokes.push({ id, color: stroke.color, path, straight: stroke.straight })
      if (run.inside) insideStrokeIds.push(id)
    }
  }

  return changed ? { graph: { vertices, strokes }, insideStrokeIds, changed } : { graph, insideStrokeIds, changed }
}
