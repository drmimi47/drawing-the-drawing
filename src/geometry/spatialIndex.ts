import type { Graph } from '../types/geometry'
import { deriveEdges } from './graph'

/**
 * Spatial index + snap targets (Cluster 3).
 *
 * A lightweight uniform spatial hash grid over the PSLG's snap-able features.
 * Point queries (used by the snapping engine) only ever touch the handful of grid
 * cells overlapping the query radius, so lookups stay O(1)-ish regardless of how
 * large the graph grows — no full scan of every vertex on each pointer move.
 *
 * Two kinds of snap target are indexed:
 *   VERTEX   — every graph vertex (this also covers intersections, since the PSLG
 *              already inserts a shared vertex at every stroke crossing)
 *   MIDPOINT — the midpoint of every derived edge
 *
 * The grid is rebuilt from the graph whenever the graph changes (see the store
 * subscription in drawingStore), so it is always in lockstep with the geometry.
 */

export type SnapKind = 'VERTEX' | 'MIDPOINT'

export interface SnapPoint {
  x: number
  y: number
  kind: SnapKind
  /** Vertex id for VERTEX snaps; null for midpoints. */
  vid: string | null
  /** Endpoint vertex ids of the edge for MIDPOINT snaps; null for vertices. */
  edge: [string, string] | null
}

/** Snap activation distance, in screen pixels (converted to world units via zoom). */
export const SNAP_THRESHOLD_PX = 8

/** Grid cell size in world units. ~one snap-radius-worth keeps buckets small. */
const DEFAULT_CELL = 64

/** True when a snap target touches any of the excluded vertex ids. */
function isExcluded(p: SnapPoint, exclude: Set<string>): boolean {
  if (p.kind === 'VERTEX') return p.vid != null && exclude.has(p.vid)
  if (p.edge) return exclude.has(p.edge[0]) || exclude.has(p.edge[1])
  return false
}

export class SpatialGrid {
  private readonly cell: number
  private readonly buckets = new Map<string, SnapPoint[]>()

  constructor(cell = DEFAULT_CELL) {
    this.cell = cell
  }

  private key(cx: number, cy: number): string {
    return `${cx}:${cy}`
  }

  insert(p: SnapPoint): void {
    const cx = Math.floor(p.x / this.cell)
    const cy = Math.floor(p.y / this.cell)
    const k = this.key(cx, cy)
    const bucket = this.buckets.get(k)
    if (bucket) bucket.push(p)
    else this.buckets.set(k, [p])
  }

  /**
   * Nearest snap target within `radius` (world units), or null. Vertices win over
   * midpoints when both are in range (endpoint snaps are the stronger intent),
   * with ties broken by distance. `exclude` skips any target touching those vertex
   * ids — used so a dragged vertex never snaps to itself or its own midpoints.
   */
  nearest(x: number, y: number, radius: number, exclude?: Set<string>): SnapPoint | null {
    const r2 = radius * radius
    const minCx = Math.floor((x - radius) / this.cell)
    const maxCx = Math.floor((x + radius) / this.cell)
    const minCy = Math.floor((y - radius) / this.cell)
    const maxCy = Math.floor((y + radius) / this.cell)

    let bestVertex: SnapPoint | null = null
    let bestVertexD = r2
    let bestMid: SnapPoint | null = null
    let bestMidD = r2

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(this.key(cx, cy))
        if (!bucket) continue
        for (const p of bucket) {
          if (exclude && isExcluded(p, exclude)) continue
          const dx = p.x - x
          const dy = p.y - y
          const d = dx * dx + dy * dy
          if (p.kind === 'VERTEX') {
            if (d < bestVertexD) {
              bestVertexD = d
              bestVertex = p
            }
          } else if (d < bestMidD) {
            bestMidD = d
            bestMid = p
          }
        }
      }
    }
    return bestVertex ?? bestMid
  }
}

/** Build a fresh spatial index of all snap targets in the graph. */
export function buildSnapIndex(graph: Graph, cell = DEFAULT_CELL): SpatialGrid {
  const grid = new SpatialGrid(cell)

  for (const id in graph.vertices) {
    const v = graph.vertices[id]
    grid.insert({ x: v.x, y: v.y, kind: 'VERTEX', vid: id, edge: null })
  }

  for (const e of deriveEdges(graph)) {
    const a = graph.vertices[e.v0]
    const b = graph.vertices[e.v1]
    if (!a || !b) continue
    grid.insert({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      kind: 'MIDPOINT',
      vid: null,
      edge: [e.v0, e.v1],
    })
  }

  return grid
}
