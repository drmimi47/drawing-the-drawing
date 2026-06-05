import { describe, it, expect } from 'vitest'
import type { Boundary, CirculationPath, Department } from '../types/geometry'
import { generateRooms } from './rooms'
import {
  buildDragRig,
  buildRoomSnapTargets,
  applyEdgeSplits,
  findEdgeSplits,
  snapRoomCorner,
  clampToLot,
  wouldStaySimple,
  wouldOverlap,
  applyVertexUpdates,
  type VertexUpdate,
} from './roomEdit'

/**
 * Reproduces the Rooms-layer Edit-tool drag pipeline exactly as useVectorEdit runs it,
 * but as pure geometry (no R3F / store), so we can assert a corner drag is ACCEPTED at
 * both blank-sheet (small lot) and map (large lot) scales. The reported bug is "room
 * vertices ignore user control on the Blank Sheet substrate" — i.e. drags get rejected.
 */

// Hook constants (kept in sync with useVectorEdit.ts).
const WELD_MAX_WORLD = 2
const OVERLAP_AREA_EPS = 1
const ZOOM = 1
const WELD_EPS_PX = 6

function squareLot(size: number): Boundary {
  return { ring: [
    { x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size },
  ], isClosed: true }
}

/** Two side-by-side departments so the partition has a shared interior seam to grab. */
function twoDepts(size: number): Department[] {
  const q = size / 4
  return [
    { id: 'A', name: 'A', x: q, y: size / 2, radius: size / 3, color: '#f00', roomCount: 2 },
    { id: 'B', name: 'B', x: size - q, y: size / 2, radius: size / 3, color: '#00f', roomCount: 2 },
  ]
}

/** Run the full useVectorEdit room-drag for a grab at (gx,gy) → target (tx,ty).
 *  Returns whether the move was applied, mirroring the hook's accept/reject logic. */
function simulateDrag(
  boundary: Boundary,
  rooms: ReturnType<typeof generateRooms>,
  paths: CirculationPath[],
  gx: number, gy: number, tx: number, ty: number,
): { applied: boolean; reason?: string } {
  const weld = Math.min(WELD_EPS_PX / ZOOM, WELD_MAX_WORLD)
  // beginRoomCornerDrag: split T-junctions then build rig on post-split rings.
  const splits = findEdgeSplits(rooms, gx, gy, weld)
  const split = splits.length > 0 ? applyEdgeSplits(rooms, splits) : rooms
  const rig = buildDragRig(split, gx, gy, weld)
  if (rig.anchors.length === 0) return { applied: false, reason: 'no anchor grabbed' }
  const cands = buildRoomSnapTargets(split, boundary, paths, rig.anchors)

  let rx = tx
  let ry = ty
  // snapping ON by default; a vertex/edge within range wins.
  const s = snapRoomCorner(cands, rx, ry, 8 / ZOOM)
  if (s) { rx = s.x; ry = s.y }
  // clamp to lot.
  if (boundary.ring.length >= 3) {
    const c = clampToLot(boundary.ring, rx, ry)
    rx = c.x; ry = c.y
  }
  const updates: VertexUpdate[] = rig.anchors.map((a) => ({ roomId: a.roomId, index: a.index, x: rx, y: ry }))
  for (const sl of rig.sliders) {
    updates.push({ roomId: sl.roomId, index: sl.index, x: rx + sl.t * (sl.far.x - rx), y: ry + sl.t * (sl.far.y - ry) })
  }
  const affected = new Set(updates.map((u) => u.roomId))
  const proposed = applyVertexUpdates(split, updates)
  for (let i = 0; i < split.length; i++) {
    if (affected.has(split[i].roomId) && !wouldStaySimple(proposed[i])) {
      return { applied: false, reason: 'self-intersect' }
    }
  }
  if (wouldOverlap(split, updates, OVERLAP_AREA_EPS, [])) return { applied: false, reason: 'overlap' }
  return { applied: true }
}

/** Find an interior (non-boundary) vertex shared by ≥2 rooms — a grabbable seam corner. */
function findSharedInteriorCorner(rooms: ReturnType<typeof generateRooms>, boundary: Boundary) {
  const onBoundary = (x: number, y: number) =>
    boundary.ring.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6) ||
    x < 1e-6 || y < 1e-6 // also treat lot edges (x=0/y=0) loosely as boundary
  const counts = new Map<string, { x: number; y: number; n: number }>()
  for (const r of rooms) {
    for (const p of r.polygon) {
      const k = `${Math.round(p.x)}:${Math.round(p.y)}`
      const e = counts.get(k) ?? { x: p.x, y: p.y, n: 0 }
      e.n++
      counts.set(k, e)
    }
  }
  for (const e of counts.values()) {
    if (e.n >= 2 && !onBoundary(e.x, e.y)) return e
  }
  return null
}

describe('Rooms Edit-tool drag — accepted at any lot scale', () => {
  for (const size of [200, 2000]) {
    const label = size === 200 ? 'blank-sheet (small lot)' : 'map (large lot)'
    it(`generates a multi-room layout — ${label}`, () => {
      const boundary = squareLot(size)
      const rooms = generateRooms(twoDepts(size), boundary, [], null, Math.max(4, size * 0.01))
      expect(rooms.length).toBeGreaterThanOrEqual(3)
    })

    it(`accepts a small interior-corner drag — ${label}`, () => {
      const boundary = squareLot(size)
      const rooms = generateRooms(twoDepts(size), boundary, [], null, Math.max(4, size * 0.01))
      const corner = findSharedInteriorCorner(rooms, boundary)
      expect(corner, 'should have a shared interior seam corner').not.toBeNull()
      if (!corner) return
      // Nudge the seam by a small fraction of the lot toward the lot center.
      const nudge = size * 0.04
      const dirX = corner.x < size / 2 ? 1 : -1
      const res = simulateDrag(boundary, rooms, [], corner.x, corner.y, corner.x + dirX * nudge, corner.y)
      expect(res.applied, `drag rejected: ${res.reason}`).toBe(true)
    })
  }
})
