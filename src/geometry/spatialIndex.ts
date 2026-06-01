import type { Graph } from '../types/geometry'
import { deriveEdges } from './graph'

/**
 * Spatial index + snap targets (Cluster 3, incremental refactor improvements C2).
 *
 * A uniform spatial hash grid over the PSLG's snap-able features. Point queries
 * (used by the snapping engine) only ever touch the handful of grid cells
 * overlapping the query radius, so lookups stay O(1)-ish regardless of how large
 * the graph grows — no full scan of every vertex on each pointer move.
 *
 * Two kinds of snap target are indexed:
 *   VERTEX   — every graph vertex (this also covers intersections, since the PSLG
 *              already inserts a shared vertex at every stroke crossing)
 *   MIDPOINT — the midpoint of every derived edge
 *
 * INCREMENTAL ARCHITECTURE (improvements C2)
 * Previously the entire grid was wiped and rebuilt from scratch (`buildSnapIndex`)
 * on every graph mutation — including dragging a single vertex, where the O(N)
 * rebuild tanked the framerate on large urban vector sets. The grid now supports
 * incremental edits: dragging a vertex only re-buckets that vertex and the
 * midpoints of its incident edges (a handful of cells), never the whole graph.
 *
 * The grid stores feature *topology + position*, not pre-baked SnapPoint objects:
 *   cellVerts   cellKey -> Set<vertexId>     vertices whose position falls in a cell
 *   cellMids    cellKey -> Set<edgeKey>      edges whose midpoint falls in a cell
 *   vertexPos   vertexId -> {x, y}           live vertex positions
 *   vertexCell  vertexId -> cellKey          reverse lookup: a vertex's current cell
 *   edges       edgeKey  -> [v0, v1]         edge endpoint ids
 *   edgeMidCell edgeKey  -> cellKey          reverse lookup: an edge midpoint's cell
 *   vertexEdges vertexId -> Set<edgeKey>     adjacency, so a moved vertex can
 *                                            re-bucket exactly its incident midpoints
 * A point lives in exactly one cell, so the reverse lookups are a single key (not
 * a list). SnapPoints are materialized lazily, only for the winning candidate of a
 * query, so per-move allocation churn stays near zero.
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

interface Pos {
  x: number
  y: number
}

export class SpatialGrid {
  private readonly cell: number

  private readonly cellVerts = new Map<string, Set<string>>()
  private readonly cellMids = new Map<string, Set<string>>()
  private readonly vertexPos = new Map<string, Pos>()
  private readonly vertexCell = new Map<string, string>()
  private readonly edges = new Map<string, [string, string]>()
  private readonly edgeMidCell = new Map<string, string>()
  private readonly vertexEdges = new Map<string, Set<string>>()

  constructor(cell = DEFAULT_CELL) {
    this.cell = cell
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)}:${Math.floor(y / this.cell)}`
  }

  private addToCell(map: Map<string, Set<string>>, key: string, id: string): void {
    const set = map.get(key)
    if (set) set.add(id)
    else map.set(key, new Set([id]))
  }

  private removeFromCell(map: Map<string, Set<string>>, key: string | undefined, id: string): void {
    if (key === undefined) return
    const set = map.get(key)
    if (!set) return
    set.delete(id)
    if (set.size === 0) map.delete(key) // never leave dead buckets behind
  }

  // ---- Vertices -----------------------------------------------------------

  /** Insert a vertex into its grid cell. */
  addVertex(id: string, x: number, y: number): void {
    this.vertexPos.set(id, { x, y })
    const k = this.key(x, y)
    this.vertexCell.set(id, k)
    this.addToCell(this.cellVerts, k, id)
  }

  /**
   * Move a vertex to a new position. Re-buckets the vertex only if it crossed a
   * cell boundary, and re-buckets the midpoints of its incident edges likewise.
   * This is the hot path used while dragging — it touches O(incident-edges) cells,
   * not the whole index.
   */
  moveVertex(id: string, x: number, y: number): void {
    const pos = this.vertexPos.get(id)
    if (!pos) {
      this.addVertex(id, x, y)
    } else {
      pos.x = x
      pos.y = y
      const newKey = this.key(x, y)
      const oldKey = this.vertexCell.get(id)
      if (newKey !== oldKey) {
        this.removeFromCell(this.cellVerts, oldKey, id)
        this.addToCell(this.cellVerts, newKey, id)
        this.vertexCell.set(id, newKey)
      }
    }
    // Incident edge midpoints move with the vertex.
    const incident = this.vertexEdges.get(id)
    if (incident) for (const ek of incident) this.refreshEdgeMidpoint(ek)
  }

  /** Remove a vertex (and any edges still referencing it) from the index. */
  removeVertex(id: string): void {
    const incident = this.vertexEdges.get(id)
    if (incident) for (const ek of Array.from(incident)) this.removeEdge(ek)
    this.removeFromCell(this.cellVerts, this.vertexCell.get(id), id)
    this.vertexCell.delete(id)
    this.vertexPos.delete(id)
    this.vertexEdges.delete(id)
  }

  // ---- Edges (midpoint snap targets) --------------------------------------

  /** Insert an edge's midpoint snap target and wire its endpoint adjacency. */
  addEdge(edgeKey: string, v0: string, v1: string): void {
    this.edges.set(edgeKey, [v0, v1])
    this.linkVertexEdge(v0, edgeKey)
    this.linkVertexEdge(v1, edgeKey)
    this.refreshEdgeMidpoint(edgeKey)
  }

  /** Remove an edge's midpoint snap target and unwire its adjacency. */
  removeEdge(edgeKey: string): void {
    const ends = this.edges.get(edgeKey)
    if (ends) {
      this.unlinkVertexEdge(ends[0], edgeKey)
      this.unlinkVertexEdge(ends[1], edgeKey)
    }
    this.removeFromCell(this.cellMids, this.edgeMidCell.get(edgeKey), edgeKey)
    this.edgeMidCell.delete(edgeKey)
    this.edges.delete(edgeKey)
  }

  private linkVertexEdge(vid: string, edgeKey: string): void {
    const set = this.vertexEdges.get(vid)
    if (set) set.add(edgeKey)
    else this.vertexEdges.set(vid, new Set([edgeKey]))
  }

  private unlinkVertexEdge(vid: string, edgeKey: string): void {
    const set = this.vertexEdges.get(vid)
    if (!set) return
    set.delete(edgeKey)
    if (set.size === 0) this.vertexEdges.delete(vid)
  }

  /** Recompute an edge's midpoint cell, re-bucketing only if it changed cells. */
  private refreshEdgeMidpoint(edgeKey: string): void {
    const ends = this.edges.get(edgeKey)
    if (!ends) return
    const a = this.vertexPos.get(ends[0])
    const b = this.vertexPos.get(ends[1])
    if (!a || !b) return
    const newKey = this.key((a.x + b.x) / 2, (a.y + b.y) / 2)
    const oldKey = this.edgeMidCell.get(edgeKey)
    if (newKey !== oldKey) {
      this.removeFromCell(this.cellMids, oldKey, edgeKey)
      this.addToCell(this.cellMids, newKey, edgeKey)
      this.edgeMidCell.set(edgeKey, newKey)
    }
  }

  // ---- Queries ------------------------------------------------------------

  /**
   * Return all edges whose midpoints fall within the 3×3 cell neighborhood of
   * (x, y). Used by the polyline snapping pipeline (Step 2) to build a small
   * local candidate set for perpendicular and parallel evaluation — the midpoint
   * bucket means only genuinely nearby edges are returned (O(1) cell lookups,
   * not an O(N) full-graph scan). Returns live position references; caller must
   * only read them synchronously within the same animation frame.
   */
  nearbyEdgeEndpoints(
    x: number,
    y: number,
  ): Array<{ key: string; a: { x: number; y: number }; b: { x: number; y: number } }> {
    const cx = Math.floor(x / this.cell)
    const cy = Math.floor(y / this.cell)
    const result: Array<{ key: string; a: { x: number; y: number }; b: { x: number; y: number } }> = []
    for (let qx = cx - 1; qx <= cx + 1; qx++) {
      for (let qy = cy - 1; qy <= cy + 1; qy++) {
        const mids = this.cellMids.get(`${qx}:${qy}`)
        if (!mids) continue
        for (const ek of mids) {
          const ends = this.edges.get(ek)
          if (!ends) continue
          const a = this.vertexPos.get(ends[0])
          const b = this.vertexPos.get(ends[1])
          if (a && b) result.push({ key: ek, a, b })
        }
      }
    }
    return result
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

    let bestVid: string | null = null
    let bestVx = 0
    let bestVy = 0
    let bestVertexD = r2

    let bestEdge: [string, string] | null = null
    let bestMx = 0
    let bestMy = 0
    let bestMidD = r2

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = `${cx}:${cy}`

        const verts = this.cellVerts.get(key)
        if (verts) {
          for (const vid of verts) {
            if (exclude && exclude.has(vid)) continue
            const p = this.vertexPos.get(vid)!
            const dx = p.x - x
            const dy = p.y - y
            const d = dx * dx + dy * dy
            if (d < bestVertexD) {
              bestVertexD = d
              bestVid = vid
              bestVx = p.x
              bestVy = p.y
            }
          }
        }

        const mids = this.cellMids.get(key)
        if (mids) {
          for (const ek of mids) {
            const ends = this.edges.get(ek)!
            if (exclude && (exclude.has(ends[0]) || exclude.has(ends[1]))) continue
            const a = this.vertexPos.get(ends[0])!
            const b = this.vertexPos.get(ends[1])!
            const mx = (a.x + b.x) / 2
            const my = (a.y + b.y) / 2
            const dx = mx - x
            const dy = my - y
            const d = dx * dx + dy * dy
            if (d < bestMidD) {
              bestMidD = d
              bestEdge = ends
              bestMx = mx
              bestMy = my
            }
          }
        }
      }
    }

    if (bestVid !== null) return { x: bestVx, y: bestVy, kind: 'VERTEX', vid: bestVid, edge: null }
    if (bestEdge !== null) return { x: bestMx, y: bestMy, kind: 'MIDPOINT', vid: null, edge: bestEdge }
    return null
  }
}

/** Build a fresh spatial index of all snap targets in the graph. */
export function buildSnapIndex(graph: Graph, cell = DEFAULT_CELL): SpatialGrid {
  const grid = new SpatialGrid(cell)

  for (const id in graph.vertices) {
    const v = graph.vertices[id]
    grid.addVertex(id, v.x, v.y)
  }

  for (const e of deriveEdges(graph)) {
    if (graph.vertices[e.v0] && graph.vertices[e.v1]) grid.addEdge(e.id, e.v0, e.v1)
  }

  return grid
}
