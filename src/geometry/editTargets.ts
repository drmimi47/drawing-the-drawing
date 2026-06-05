import type { Boundary, CirculationPath, Department, Graph, IntentPin, Room } from '../types/geometry'
import type { PipelineLayer } from '../store/drawingStore'

/**
 * The set of geometry the Edit (Vector) tool exposes for direct manipulation,
 * chosen by the ACTIVE pipeline layer so editing is always scoped to what that
 * layer is about (and, since these read the live store, to the active board):
 *   • BOUNDARY     → the lot-boundary ring vertices + its edges.
 *   • CIRCULATION  → every circulation centerline's vertices + edges.
 *   • DEPARTMENTS  → the department-zone centers (no edges).
 *   • INTENT       → the intent-pin centers (no edges).
 *   • otherwise    → the planar-graph vertices (edges are the visible strokes).
 *
 * Each draggable point carries an opaque `key` that both the renderer (to draw the
 * handle) and the tool (to apply the drag) agree on:
 *   graph vertex id   → "<vertexId>"        (no colons)
 *   boundary vertex   → "bnd:<index>"
 *   circulation vertex→ "circ:<pathId>:<index>"   (pathId has no colon)
 *   department zone   → "dept:<deptId>"           (deptId has no colon)
 *   intent pin        → "pin:<pinId>"             (pinId has no colon)
 *   room vertex       → "room:<roomId>:<index>"   (roomId has no colon)
 */

export interface EditTarget {
  key: string
  x: number
  y: number
}

/** An editable edge as a flat [ax, ay, bx, by] (world coords) for the wireframe. */
export type EditEdge = [number, number, number, number]

export function getEditTargets(
  layer: PipelineLayer,
  graph: Graph,
  boundary: Boundary | null,
  circulationPaths: CirculationPath[],
  intentPins: IntentPin[] = [],
  departments: Department[] = [],
  rooms: Room[] = [],
): { points: EditTarget[]; edges: EditEdge[] } {
  if (layer === 'ROOMS') {
    const points: EditTarget[] = []
    const edges: EditEdge[] = []
    for (const r of rooms) {
      const ring = r.polygon
      if (ring.length < 3) continue
      ring.forEach((p, i) => points.push({ key: `room:${r.roomId}:${i}`, x: p.x, y: p.y }))
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        edges.push([a.x, a.y, b.x, b.y])
      }
    }
    return { points, edges }
  }

  if (layer === 'DEPARTMENTS') {
    return { points: departments.map((d) => ({ key: `dept:${d.id}`, x: d.x, y: d.y })), edges: [] }
  }

  if (layer === 'INTENT') {
    return { points: intentPins.map((p) => ({ key: `pin:${p.id}`, x: p.x, y: p.y })), edges: [] }
  }

  if (layer === 'BOUNDARY') {
    if (!boundary || boundary.ring.length === 0) return { points: [], edges: [] }
    const ring = boundary.ring
    const points = ring.map((p, i) => ({ key: `bnd:${i}`, x: p.x, y: p.y }))
    const edges: EditEdge[] = []
    for (let i = 0; i < ring.length - 1; i++) edges.push([ring[i].x, ring[i].y, ring[i + 1].x, ring[i + 1].y])
    // Closing edge only for a complete loop.
    if (boundary.isClosed !== false && ring.length > 2) {
      const a = ring[ring.length - 1]
      const b = ring[0]
      edges.push([a.x, a.y, b.x, b.y])
    }
    return { points, edges }
  }

  if (layer === 'CIRCULATION') {
    const points: EditTarget[] = []
    const edges: EditEdge[] = []
    for (const path of circulationPaths) {
      const c = path.centerline
      c.forEach((p, i) => points.push({ key: `circ:${path.id}:${i}`, x: p.x, y: p.y }))
      for (let i = 0; i < c.length - 1; i++) edges.push([c[i].x, c[i].y, c[i + 1].x, c[i + 1].y])
    }
    return { points, edges }
  }

  const points: EditTarget[] = Object.keys(graph.vertices).map((id) => {
    const v = graph.vertices[id]
    return { key: id, x: v.x, y: v.y }
  })
  return { points, edges: [] }
}
