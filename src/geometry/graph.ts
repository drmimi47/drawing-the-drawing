import type { Edge, Graph, LineStyle, PathPoint, RawSample, SamplePoint, Stroke, Vertex } from '../types/geometry'
import { clipPolylineCapsule } from './erase'

/**
 * Planar graph operations (Cluster D) — the editable source of truth.
 *
 * Strokes are ordered paths through shared vertices. When a new stroke crosses
 * existing strokes, ONE vertex is inserted into both paths at each crossing, so
 * the strokes meet at a real node the mutation system can act on later.
 */

let idCounter = 0
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`
}

/** Resolve a stroke's path into world-space centerline points (position + half-width). */
export function resolveStrokePoints(graph: Graph, stroke: Stroke): SamplePoint[] {
  const out: SamplePoint[] = []
  for (const pp of stroke.path) {
    const v = graph.vertices[pp.v]
    if (v) out.push({ x: v.x, y: v.y, w: pp.w })
  }
  return out
}

/** Derive the edge list (one edge per consecutive vertex pair in each stroke). */
export function deriveEdges(graph: Graph): Edge[] {
  const edges: Edge[] = []
  for (const stroke of graph.strokes) {
    for (let i = 0; i < stroke.path.length - 1; i++) {
      edges.push({
        id: `${stroke.id}:${i}`,
        strokeId: stroke.id,
        v0: stroke.path[i].v,
        v1: stroke.path[i + 1].v,
      })
    }
  }
  return edges
}

/** Proper segment-segment crossing strictly interior to both segments, or null. */
function segmentIntersection(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): { x: number; y: number; t: number; u: number } | null {
  const rx = bx - ax
  const ry = by - ay
  const sx = dx - cx
  const sy = dy - cy
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-12) return null // parallel / degenerate

  const t = ((cx - ax) * sy - (cy - ay) * sx) / denom
  const u = ((cx - ax) * ry - (cy - ay) * rx) / denom
  const eps = 1e-6
  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) {
    return { x: ax + t * rx, y: ay + t * ry, t, u }
  }
  return null
}

interface Insertion {
  key: number // sort key along the segment (t for the new stroke, u for an existing edge)
  vid: string
  w: number
}

/** Rebuild a path, splicing inserted vertices into their segments (sorted). */
function rebuildPath(path: PathPoint[], inserts: Map<number, Insertion[]>): PathPoint[] {
  const out: PathPoint[] = []
  for (let i = 0; i < path.length; i++) {
    out.push(path[i])
    const ins = inserts.get(i)
    if (ins) {
      ins.sort((a, b) => a.key - b.key)
      for (const x of ins) out.push({ v: x.vid, w: x.w })
    }
  }
  return out
}

/**
 * Add a freehand stroke (resolved centerline points) to the graph, splitting it
 * and any existing strokes at crossings with shared vertices.
 */
export function addStrokeToGraph(
  graph: Graph,
  points: SamplePoint[],
  color: string,
  raw?: RawSample[],
  straight?: boolean,
  style?: { strokeWidth?: number; lineStyle?: LineStyle },
): Graph {
  const vertices: Record<string, Vertex> = { ...graph.vertices }

  // New stroke gets its own vertices first.
  const path: PathPoint[] = []
  for (const p of points) {
    const id = newId('v')
    vertices[id] = { id, x: p.x, y: p.y }
    path.push({ v: id, w: p.w })
  }

  const posOf = (vid: string) => vertices[vid]

  // Find all crossings of the new path against existing strokes.
  const newInserts = new Map<number, Insertion[]>()
  const existingInserts = new Map<string, Map<number, Insertion[]>>()

  for (const es of graph.strokes) {
    for (let j = 0; j < es.path.length - 1; j++) {
      const a = posOf(es.path[j].v)
      const b = posOf(es.path[j + 1].v)
      if (!a || !b) continue
      for (let i = 0; i < path.length - 1; i++) {
        const c = posOf(path[i].v)
        const d = posOf(path[i + 1].v)
        const hit = segmentIntersection(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)
        if (!hit) continue

        const vid = newId('v')
        vertices[vid] = { id: vid, x: hit.x, y: hit.y }
        const existingW = es.path[j].w + (es.path[j + 1].w - es.path[j].w) * hit.u
        const newW = path[i].w + (path[i + 1].w - path[i].w) * hit.t

        if (!newInserts.has(i)) newInserts.set(i, [])
        newInserts.get(i)!.push({ key: hit.t, vid, w: newW })

        if (!existingInserts.has(es.id)) existingInserts.set(es.id, new Map())
        const m = existingInserts.get(es.id)!
        if (!m.has(j)) m.set(j, [])
        m.get(j)!.push({ key: hit.u, vid, w: existingW })
      }
    }
  }

  const newStroke: Stroke = {
    id: newId('s'),
    color,
    path: newInserts.size > 0 ? rebuildPath(path, newInserts) : path,
    raw,
    straight,
    strokeWidth: style?.strokeWidth,
    lineStyle: style?.lineStyle,
  }

  const strokes = graph.strokes.map((es) => {
    const m = existingInserts.get(es.id)
    return m ? { ...es, path: rebuildPath(es.path, m) } : es
  })
  strokes.push(newStroke)

  return { vertices, strokes }
}

/**
 * Erase along the swept capsule. Affected strokes are rebuilt from the surviving
 * runs with fresh vertices; vertices referenced by no surviving stroke are
 * dropped. Returns the same graph reference when nothing changed.
 */
export function eraseGraphCapsule(
  graph: Graph,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): Graph {
  let changed = false
  const vertices: Record<string, Vertex> = {}
  const strokes: Stroke[] = []

  for (const stroke of graph.strokes) {
    const pts = resolveStrokePoints(graph, stroke)
    const { runs, modified } = clipPolylineCapsule(pts, ax, ay, bx, by, r)

    if (!modified) {
      // Keep the stroke and the vertices it references.
      for (const pp of stroke.path) {
        const v = graph.vertices[pp.v]
        if (v) vertices[v.id] = v
      }
      strokes.push(stroke)
      continue
    }

    changed = true
    for (const run of runs) {
      const path: PathPoint[] = run.map((sp) => {
        const id = newId('v')
        vertices[id] = { id, x: sp.x, y: sp.y }
        return { v: id, w: sp.w }
      })
      strokes.push({
        id: newId('s'),
        color: stroke.color,
        path,
        straight: stroke.straight,
        strokeWidth: stroke.strokeWidth,
        lineStyle: stroke.lineStyle,
      })
    }
  }

  return changed ? { vertices, strokes } : graph
}
