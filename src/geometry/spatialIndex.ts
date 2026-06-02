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
 * SEGMENT-CELL INTERSECTION INDEXING (Cluster 1 — long-edge blind-spot fix)
 * Edges are no longer bucketed by their single midpoint cell. A long wall whose
 * endpoints sit many cells away from its midpoint used to be invisible to the
 * 3×3 `nearbyEdgeEndpoints` query everywhere except near its center, so edge
 * snapping died along most of its length. Instead, every edge is registered into
 * *all* grid cells its segment physically traverses (supercover voxel traversal),
 * so edge detection fires uniformly from end to end. The midpoint is a point ON
 * the segment, so its cell is always among the traversed cells — `nearest()`'s
 * MIDPOINT snap still works (it distance-tests the true midpoint and ignores the
 * extra cells an edge now occupies).
 *
 * The grid stores feature *topology + position*, not pre-baked SnapPoint objects:
 *   cellVerts   cellKey -> Set<vertexId>     vertices whose position falls in a cell
 *   cellEdges   cellKey -> Set<edgeKey>      edges whose segment passes through a cell
 *   vertexPos   vertexId -> {x, y}           live vertex positions
 *   vertexCell  vertexId -> cellKey          reverse lookup: a vertex's current cell
 *   edges       edgeKey  -> [v0, v1]         edge endpoint ids
 *   edgeCells   edgeKey  -> Set<cellKey>     reverse lookup: every cell an edge occupies
 *   vertexEdges vertexId -> Set<edgeKey>     adjacency, so a moved vertex can
 *                                            re-bucket exactly its incident edges
 * A vertex lives in exactly one cell (single-key reverse lookup); an edge spans a
 * set of cells, so its reverse lookup is a Set diffed on each move. SnapPoints are
 * materialized lazily, only for the winning candidate of a query, so per-move
 * allocation churn stays near zero.
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
  private readonly cellEdges = new Map<string, Set<string>>()
  private readonly vertexPos = new Map<string, Pos>()
  private readonly vertexCell = new Map<string, string>()
  private readonly edges = new Map<string, [string, string]>()
  private readonly edgeCells = new Map<string, Set<string>>()
  private readonly vertexEdges = new Map<string, Set<string>>()

  constructor(cell = DEFAULT_CELL) {
    this.cell = cell
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)}:${Math.floor(y / this.cell)}`
  }

  /**
   * Every grid cell key a segment a→b passes through (supercover voxel
   * traversal, Amanatides & Woo). Walks cell-boundary crossings in parameter
   * order, so it never skips a cell even for long, near-axis-aligned lines —
   * this is what kills the long-edge edge-snap blind spot. Iteration is bounded
   * by the Manhattan cell-distance between endpoints, so cost is proportional to
   * an edge's length in cells (a handful for normal geometry).
   */
  private edgeCellKeys(ax: number, ay: number, bx: number, by: number): string[] {
    const c = this.cell
    let cx = Math.floor(ax / c)
    let cy = Math.floor(ay / c)
    const endCx = Math.floor(bx / c)
    const endCy = Math.floor(by / c)
    const keys: string[] = [`${cx}:${cy}`]
    if (cx === endCx && cy === endCy) return keys

    const dx = bx - ax
    const dy = by - ay
    const stepX = dx > 0 ? 1 : -1
    const stepY = dy > 0 ? 1 : -1
    // t-distance (along the segment, t∈[0,1]) to the next cell boundary on each
    // axis, plus the t-increment for crossing one full cell. Axis with no motion
    // gets Infinity so it never triggers a step.
    const tDeltaX = dx !== 0 ? Math.abs(c / dx) : Infinity
    const tDeltaY = dy !== 0 ? Math.abs(c / dy) : Infinity
    let tMaxX = dx !== 0 ? ((stepX > 0 ? (cx + 1) * c : cx * c) - ax) / dx : Infinity
    let tMaxY = dy !== 0 ? ((stepY > 0 ? (cy + 1) * c : cy * c) - ay) / dy : Infinity

    const maxIter = Math.abs(endCx - cx) + Math.abs(endCy - cy) + 2
    for (let i = 0; i < maxIter; i++) {
      if (tMaxX < tMaxY) {
        cx += stepX
        tMaxX += tDeltaX
      } else {
        cy += stepY
        tMaxY += tDeltaY
      }
      keys.push(`${cx}:${cy}`)
      if (cx === endCx && cy === endCy) break
    }
    return keys
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
    // Incident edges move with the vertex — re-bucket the cells they occupy.
    const incident = this.vertexEdges.get(id)
    if (incident) for (const ek of incident) this.refreshEdgeCells(ek)
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

  /** Insert an edge into every cell it crosses and wire its endpoint adjacency. */
  addEdge(edgeKey: string, v0: string, v1: string): void {
    this.edges.set(edgeKey, [v0, v1])
    this.linkVertexEdge(v0, edgeKey)
    this.linkVertexEdge(v1, edgeKey)
    this.refreshEdgeCells(edgeKey)
  }

  /** Remove an edge from every cell it occupied and unwire its adjacency. */
  removeEdge(edgeKey: string): void {
    const ends = this.edges.get(edgeKey)
    if (ends) {
      this.unlinkVertexEdge(ends[0], edgeKey)
      this.unlinkVertexEdge(ends[1], edgeKey)
    }
    const cells = this.edgeCells.get(edgeKey)
    if (cells) for (const k of cells) this.removeFromCell(this.cellEdges, k, edgeKey)
    this.edgeCells.delete(edgeKey)
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

  /**
   * Recompute the set of cells an edge occupies and re-bucket only the diff
   * (cells it left vs. cells it newly entered). Called on insert and whenever an
   * endpoint moves, so the hot drag path touches O(edge-length-in-cells) work.
   */
  private refreshEdgeCells(edgeKey: string): void {
    const ends = this.edges.get(edgeKey)
    if (!ends) return
    const a = this.vertexPos.get(ends[0])
    const b = this.vertexPos.get(ends[1])
    if (!a || !b) return
    const newKeys = new Set(this.edgeCellKeys(a.x, a.y, b.x, b.y))
    const oldKeys = this.edgeCells.get(edgeKey)
    if (oldKeys) {
      for (const k of oldKeys) if (!newKeys.has(k)) this.removeFromCell(this.cellEdges, k, edgeKey)
      for (const k of newKeys) if (!oldKeys.has(k)) this.addToCell(this.cellEdges, k, edgeKey)
    } else {
      for (const k of newKeys) this.addToCell(this.cellEdges, k, edgeKey)
    }
    this.edgeCells.set(edgeKey, newKeys)
  }

  // ---- Queries ------------------------------------------------------------

  /**
   * Return every edge passing through the 3×3 cell neighborhood of (x, y). Used
   * by the polyline snapping pipeline to build a small local candidate set for
   * perpendicular / parallel / edge ("nearest on line") evaluation. Because edges
   * are now bucketed into every cell they traverse (not just their midpoint cell),
   * this reliably returns long edges that merely *pass near* the cursor — fixing
   * the long-edge blind spot — while staying O(1) in cell lookups. Edges spanning
   * multiple cells in the block are de-duplicated. Returns live position
   * references; caller must read them synchronously within the same frame.
   */
  nearbyEdgeEndpoints(
    x: number,
    y: number,
  ): Array<{ key: string; a: { x: number; y: number }; b: { x: number; y: number } }> {
    const cx = Math.floor(x / this.cell)
    const cy = Math.floor(y / this.cell)
    const result: Array<{ key: string; a: { x: number; y: number }; b: { x: number; y: number } }> = []
    const seen = new Set<string>()
    for (let qx = cx - 1; qx <= cx + 1; qx++) {
      for (let qy = cy - 1; qy <= cy + 1; qy++) {
        const cellEdges = this.cellEdges.get(`${qx}:${qy}`)
        if (!cellEdges) continue
        for (const ek of cellEdges) {
          if (seen.has(ek)) continue
          seen.add(ek)
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

    // An edge now lives in many cells, so it can appear in several cells of this
    // query block — only its true midpoint matters, so test each edge once.
    const seenMids = new Set<string>()

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

        const cellEdges = this.cellEdges.get(key)
        if (cellEdges) {
          for (const ek of cellEdges) {
            if (seenMids.has(ek)) continue
            seenMids.add(ek)
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
