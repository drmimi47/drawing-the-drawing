import * as turf from '@turf/turf'
import type { Boundary, CirculationPath, Room } from '../types/geometry'
import { centerlineToBandRing } from './corridor'
import { pointInPolygon } from './locks'

/**
 * Geometry for the Rooms-layer Edit tool (free corner welding).
 *
 * Dragging a room corner moves the WHOLE joint: every room vertex coincident with the
 * grabbed point (a weld cluster) moves together, so shared walls stay shared and adjacent
 * rooms reflow with the drag. The dragged corner snaps to nearby room edges, the lot
 * boundary, or a circulation hallway border.
 */

export type Pt = { x: number; y: number }
export interface RoomCornerRef {
  roomId: string
  index: number
}
export interface RoomSnapTargets {
  points: Pt[]
  segments: [Pt, Pt][]
}

/** All room vertices within `eps` of (x, y) — the joint that moves together on drag. */
export function buildWeldCluster(rooms: Room[], x: number, y: number, eps: number): RoomCornerRef[] {
  const e2 = eps * eps
  const out: RoomCornerRef[] = []
  for (const r of rooms) {
    r.polygon.forEach((p, i) => {
      const dx = p.x - x
      const dy = p.y - y
      if (dx * dx + dy * dy <= e2) out.push({ roomId: r.roomId, index: i })
    })
  }
  return out
}

/** A T-junction vertex sitting on a wall that pivots with the drag — it slides along the
 *  (moving) wall toward a fixed far endpoint, staying glued so no gap opens. */
export interface SliderRef {
  roomId: string
  index: number
  far: Pt
  t: number
}
/** Everything that moves for one corner drag: anchors snap to the cursor; sliders glide. */
export interface DragRig {
  anchors: RoomCornerRef[]
  sliders: SliderRef[]
}

const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2

/**
 * Build the drag rig for a grab at (x, y):
 *   • anchors  = every room vertex coincident with the point (the welded joint),
 *   • sliders  = every OTHER room vertex lying on the interior of a wall incident to an
 *                anchor (a T-junction along a moving wall). As the wall pivots, a slider
 *                keeps its fraction along it, so the neighbor stays glued — no gap.
 * Run this on the post-split rings (see findEdgeSplits/applyEdgeSplits).
 */
export function buildDragRig(rooms: Room[], x: number, y: number, eps: number): DragRig {
  const e2 = eps * eps
  const anchors: RoomCornerRef[] = []
  const movingFar: Pt[] = []
  for (const r of rooms) {
    const ring = r.polygon
    const n = ring.length
    for (let i = 0; i < n; i++) {
      if (dist2(ring[i].x, ring[i].y, x, y) > e2) continue
      anchors.push({ roomId: r.roomId, index: i })
      // The two walls meeting at this corner pivot around their fixed far endpoints.
      for (const far of [ring[(i - 1 + n) % n], ring[(i + 1) % n]]) {
        if (dist2(far.x, far.y, x, y) > e2) movingFar.push({ x: far.x, y: far.y })
      }
    }
  }

  const sliders: SliderRef[] = []
  for (const r of rooms) {
    const ring = r.polygon
    ring.forEach((v, i) => {
      if (dist2(v.x, v.y, x, y) <= e2) return // an anchor
      for (const far of movingFar) {
        if (dist2(v.x, v.y, far.x, far.y) <= e2) continue // the fixed far corner itself
        const pr = projOnSeg(v.x, v.y, { x, y }, far)
        if (pr.d2 > e2) continue // not on this wall
        const lx = far.x - x
        const ly = far.y - y
        const len2 = lx * lx + ly * ly
        if (len2 <= 1e-9) continue
        let t = ((v.x - x) * lx + (v.y - y) * ly) / len2
        if (t <= 0.001 || t >= 0.999) continue // endpoint, not interior
        t = t < 0 ? 0 : t > 1 ? 1 : t
        sliders.push({ roomId: r.roomId, index: i, far: { x: far.x, y: far.y }, t })
        break
      }
    })
  }
  return { anchors, sliders }
}

const keyOf = (roomId: string, index: number) => `${roomId}:${index}`

export interface EdgeSplit {
  roomId: string
  /** Insert the new vertex AFTER this vertex index (i.e. on edge index→index+1). */
  edgeIndex: number
  point: Pt
}

/**
 * T-junction fix: find every room edge that passes through (x, y) but has NO vertex there
 * (a room abutting the grabbed point along an edge interior). Splitting those edges and
 * welding the new vertices into the drag makes neighbors "accommodate" the move with no gap.
 */
export function findEdgeSplits(rooms: Room[], x: number, y: number, eps: number): EdgeSplit[] {
  const e2 = eps * eps
  const out: EdgeSplit[] = []
  for (const r of rooms) {
    const ring = r.polygon
    const n = ring.length
    if (n < 3) continue
    // A room that already has a vertex at the point moves via the weld cluster — skip it.
    if (ring.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= e2)) continue
    let bi = -1
    let bp: Pt | null = null
    let bd = e2
    for (let i = 0; i < n; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % n]
      const pr = projOnSeg(x, y, a, b)
      const endA = (pr.x - a.x) ** 2 + (pr.y - a.y) ** 2 <= e2
      const endB = (pr.x - b.x) ** 2 + (pr.y - b.y) ** 2 <= e2
      if (!endA && !endB && pr.d2 <= bd) {
        bd = pr.d2
        bi = i
        bp = { x: pr.x, y: pr.y }
      }
    }
    if (bi >= 0 && bp) out.push({ roomId: r.roomId, edgeIndex: bi, point: bp })
  }
  return out
}

/** Insert the split points into their rooms' rings (area-neutral — points lie on the edge). */
export function applyEdgeSplits(rooms: Room[], splits: EdgeSplit[]): Room[] {
  if (splits.length === 0) return rooms
  const byRoom = new Map<string, EdgeSplit[]>()
  for (const s of splits) {
    let list = byRoom.get(s.roomId)
    if (!list) byRoom.set(s.roomId, (list = []))
    list.push(s)
  }
  return rooms.map((r) => {
    const list = byRoom.get(r.roomId)
    if (!list) return r
    const polygon = [...r.polygon]
    // Insert from the highest edge index down so earlier indices stay valid.
    list.sort((a, b) => b.edgeIndex - a.edgeIndex)
    for (const s of list) polygon.splice(s.edgeIndex + 1, 0, { x: s.point.x, y: s.point.y })
    return { ...r, polygon }
  })
}

/**
 * Candidate vertices/segments the dragged corner can snap onto:
 *   • every OTHER room's vertices + edges (cluster vertices excluded; edges touching a
 *     cluster vertex skipped so the corner can't snap to a wall that moves with it),
 *   • the lot boundary ring,
 *   • each circulation path's border band.
 */
export function buildRoomSnapTargets(
  rooms: Room[],
  boundary: Boundary | null,
  paths: CirculationPath[],
  cluster: RoomCornerRef[],
): RoomSnapTargets {
  const clusterKeys = new Set(cluster.map((c) => keyOf(c.roomId, c.index)))
  const points: Pt[] = []
  const segments: [Pt, Pt][] = []

  for (const r of rooms) {
    const ring = r.polygon
    const n = ring.length
    if (n < 2) continue
    const inCluster = ring.map((_, i) => clusterKeys.has(keyOf(r.roomId, i)))
    ring.forEach((p, i) => {
      if (!inCluster[i]) points.push({ x: p.x, y: p.y })
    })
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      // Skip edges with a moving endpoint — they shift with the cluster.
      if (inCluster[i] || inCluster[j]) continue
      segments.push([ring[i], ring[j]])
    }
  }

  const addRing = (ring: Pt[], closed: boolean) => {
    const n = ring.length
    if (n < 2) return
    for (const p of ring) points.push({ x: p.x, y: p.y })
    const last = closed ? n : n - 1
    for (let i = 0; i < last; i++) segments.push([ring[i], ring[(i + 1) % n]])
  }

  if (boundary && boundary.ring.length >= 2) addRing(boundary.ring, boundary.isClosed !== false)
  for (const path of paths) {
    const band = centerlineToBandRing(path.centerline, path.width)
    if (band.length >= 3) addRing(band, true)
  }

  return { points, segments }
}

/** Nearest point on segment ab to p, with squared distance. */
function projOnSeg(px: number, py: number, a: Pt, b: Pt): { x: number; y: number; d2: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const x = a.x + t * dx
  const y = a.y + t * dy
  const ex = px - x
  const ey = py - y
  return { x, y, d2: ex * ex + ey * ey }
}

/** Snap (x, y) onto the nearest candidate: vertex first, then segment projection, within thr. */
export function snapRoomCorner(targets: RoomSnapTargets, x: number, y: number, thr: number): Pt | null {
  const thr2 = thr * thr
  let best: Pt | null = null
  let bestD2 = thr2
  for (const p of targets.points) {
    const dx = p.x - x
    const dy = p.y - y
    const d2 = dx * dx + dy * dy
    if (d2 <= bestD2) {
      bestD2 = d2
      best = { x: p.x, y: p.y }
    }
  }
  if (best) return best // a vertex within range always wins over an edge

  for (const [a, b] of targets.segments) {
    const pr = projOnSeg(x, y, a, b)
    if (pr.d2 <= bestD2) {
      bestD2 = pr.d2
      best = { x: pr.x, y: pr.y }
    }
  }
  return best
}

/** Keep (x, y) inside the lot: if it falls outside the boundary ring, project it onto the
 *  nearest boundary edge (so a dragged corner sticks to the border, never past it). */
export function clampToLot(ring: Pt[], x: number, y: number): Pt {
  if (ring.length < 3 || pointInPolygon(x, y, ring)) return { x, y }
  let best: Pt = { x, y }
  let bestD2 = Infinity
  for (let i = 0; i < ring.length; i++) {
    const pr = projOnSeg(x, y, ring[i], ring[(i + 1) % ring.length])
    if (pr.d2 < bestD2) {
      bestD2 = pr.d2
      best = { x: pr.x, y: pr.y }
    }
  }
  return best
}

/** Nearest point on any of the given closed rings' edges (used to keep a corner glued to a
 *  circulation hallway border so the corridor stays bordered by rooms). */
export function projectOntoRings(rings: Pt[][], x: number, y: number): Pt {
  let best: Pt = { x, y }
  let bestD2 = Infinity
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const pr = projOnSeg(x, y, ring[i], ring[(i + 1) % ring.length])
      if (pr.d2 < bestD2) {
        bestD2 = pr.d2
        best = { x: pr.x, y: pr.y }
      }
    }
  }
  return best
}

/** True if the point is within `tol` of any of the rings' edges (i.e. on that border). */
export function nearAnyRingEdge(rings: Pt[][], x: number, y: number, tol: number): boolean {
  const t2 = tol * tol
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      if (projOnSeg(x, y, ring[i], ring[(i + 1) % ring.length]).d2 <= t2) return true
    }
  }
  return false
}

/** True if the (already proposed) ring is a simple polygon (no self-crossing edges). */
export function wouldStaySimple(ring: Pt[]): boolean {
  const n = ring.length
  if (n < 4) return true
  for (let i = 0; i < n; i++) {
    const a1 = ring[i]
    const a2 = ring[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent/shared-endpoint edges.
      if (j === i) continue
      const b1 = ring[j]
      const b2 = ring[(j + 1) % n]
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue
      if (i === 0 && j === n - 1) continue // first & last edges share vertex 0
      if (segmentsCross(a1, a2, b1, b2)) return false
    }
  }
  return true
}

function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

type BBox = [number, number, number, number]
function bboxOf(ring: Pt[]): BBox {
  let mnx = Infinity
  let mny = Infinity
  let mxx = -Infinity
  let mxy = -Infinity
  for (const p of ring) {
    if (p.x < mnx) mnx = p.x
    if (p.y < mny) mny = p.y
    if (p.x > mxx) mxx = p.x
    if (p.y > mxy) mxy = p.y
  }
  return [mnx, mny, mxx, mxy]
}
function bboxOverlap(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}
function shoelaceAbs(ring: { x: number; y: number }[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}
function intersectionArea(ringA: Pt[], ringB: Pt[]): number {
  try {
    const close = (r: Pt[]) => {
      const c = r.map((p) => [p.x, p.y] as [number, number])
      c.push([r[0].x, r[0].y])
      return c
    }
    const inter = turf.intersect(turf.featureCollection([turf.polygon([close(ringA)]), turf.polygon([close(ringB)])]))
    if (!inter) return 0
    const g = inter.geometry
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    let area = 0
    for (const poly of polys) {
      area += shoelaceAbs(poly[0].map((c) => ({ x: c[0], y: c[1] })))
      for (let k = 1; k < poly.length; k++) area -= shoelaceAbs(poly[k].map((c) => ({ x: c[0], y: c[1] })))
    }
    return area
  } catch {
    return 0
  }
}

export interface VertexUpdate {
  roomId: string
  index: number
  x: number
  y: number
}

/** Apply per-vertex updates, returning new room rings (area recompute is the store's job). */
export function applyVertexUpdates(rooms: Room[], updates: VertexUpdate[]): Pt[][] {
  const moved = new Map<string, Map<number, Pt>>()
  for (const u of updates) {
    let m = moved.get(u.roomId)
    if (!m) moved.set(u.roomId, (m = new Map()))
    m.set(u.index, { x: u.x, y: u.y })
  }
  return rooms.map((r) => {
    const m = moved.get(r.roomId)
    return m ? r.polygon.map((p, i) => m.get(i) ?? p) : r.polygon
  })
}

/**
 * True if the proposed vertex moves would make any affected room overlap another room — or a
 * circulation `obstacle` band — by more than `areaEps` (shared edges → ~0 area, ignored).
 * Only affected rooms can newly overlap, so we test those against everyone else + obstacles.
 */
export function wouldOverlap(
  rooms: Room[],
  updates: VertexUpdate[],
  areaEps: number,
  obstacles: Pt[][] = [],
): boolean {
  const moved = new Map<string, Map<number, Pt>>()
  for (const u of updates) {
    let m = moved.get(u.roomId)
    if (!m) moved.set(u.roomId, (m = new Map()))
    m.set(u.index, { x: u.x, y: u.y })
  }
  const entries = rooms
    .filter((r) => r.polygon.length >= 3)
    .map((r) => {
      const m = moved.get(r.roomId)
      const ring = m ? r.polygon.map((p, i) => m.get(i) ?? p) : r.polygon
      return { ring, bb: bboxOf(ring), affected: m != null }
    })
  const obs = obstacles.filter((o) => o.length >= 3).map((ring) => ({ ring, bb: bboxOf(ring) }))
  for (let i = 0; i < entries.length; i++) {
    const A = entries[i]
    if (!A.affected) continue
    for (let j = 0; j < entries.length; j++) {
      if (i === j) continue
      const B = entries[j]
      if (j < i && B.affected) continue // affected/affected pair already tested
      if (!bboxOverlap(A.bb, B.bb)) continue
      if (intersectionArea(A.ring, B.ring) > areaEps) return true
    }
    for (const o of obs) {
      if (!bboxOverlap(A.bb, o.bb)) continue
      if (intersectionArea(A.ring, o.ring) > areaEps) return true
    }
  }
  return false
}
