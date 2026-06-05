import * as turf from '@turf/turf'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { pointSegmentDistSq } from './graph'
import type { Room } from '../types/geometry'

/**
 * Wall erasing on the Rooms layer: deleting the wall between two rooms of the SAME department
 * merges them into one (the survivor fills the space, keeping the department's infill color),
 * so the department's room count drops by one. See mergeRoomsAtWall.
 */

type Pt = { x: number; y: number }

/** Squared distance from (x,y) to the nearest edge of a closed polygon ring. */
function edgeDistSq(poly: Pt[], x: number, y: number): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const d = pointSegmentDistSq(x, y, a, b)
    if (d < best) best = d
  }
  return best
}

function toFeat(ring: Pt[]): Feature<Polygon> {
  const c = ring.map((p) => [p.x, p.y])
  c.push([ring[0].x, ring[0].y])
  return turf.polygon([c])
}

/** The outer ring of a clean two-room merge, or null when the rooms don't share a real wall
 *  (a MultiPolygon = corner/disjoint touch, or a ring with a hole). */
function cleanMergeRing(f: Feature<Polygon | MultiPolygon>): Pt[] | null {
  const g = f.geometry
  if (g.type !== 'Polygon') return null // disjoint / corner-only touch ⇒ no shared wall
  if (g.coordinates.length !== 1) return null // enclosed a hole ⇒ not a clean fill
  const ring = g.coordinates[0].map(([x, y]) => ({ x, y }))
  if (ring.length > 1) {
    const a = ring[0]
    const b = ring[ring.length - 1]
    if (a.x === b.x && a.y === b.y) ring.pop()
  }
  return ring.length >= 3 ? ring : null
}

/** Coordinates rounded to this many decimals before a union, so two genuinely-adjacent rooms
 *  whose shared edge differs only by float noise still merge cleanly (no spurious MultiPolygon). */
const MERGE_PRECISION = 3

/**
 * Erase the wall nearest (x,y): merge the two ADJACENT rooms that share it into one. The survivor
 * keeps the lower roomId and the department of the LARGER room (so erasing a department-border wall
 * works too — the bigger zone absorbs the smaller), and its area is the sum. Locked rooms are
 * skipped (a frozen wall doesn't erase). Returns the updated rooms, the survivor's department, and
 * the departments whose room counts changed — or null if no shared wall lies under the point (an
 * outer/boundary wall, or rooms only touching at a corner).
 */
export function mergeRoomsAtWall(
  rooms: Room[],
  x: number,
  y: number,
  r: number,
): { rooms: Room[]; deptId: string; affected: string[] } | null {
  const r2 = r * r
  const near = rooms
    .map((rm) => ({ rm, d: edgeDistSq(rm.polygon, x, y) }))
    .filter((o) => !o.rm.isLocked && o.d <= r2)
    .sort((a, b) => a.d - b.d)

  // Closest walls first ⇒ the first adjacent pair we find is the one under the cursor.
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const a = near[i].rm
      const b = near[j].rm
      let union: Feature<Polygon | MultiPolygon> | null
      try {
        const fa = turf.truncate(toFeat(a.polygon), { precision: MERGE_PRECISION, mutate: false })
        const fb = turf.truncate(toFeat(b.polygon), { precision: MERGE_PRECISION, mutate: false })
        union = turf.union(turf.featureCollection([fa, fb])) as Feature<Polygon | MultiPolygon> | null
      } catch {
        continue
      }
      if (!union) continue
      const ring = cleanMergeRing(union)
      if (!ring) continue // only touch at a corner / not a real shared wall — try the next pair
      const keepDept = a.areaSqf >= b.areaSqf ? a.parentDeptId : b.parentDeptId
      const merged: Room = {
        roomId: a.roomId,
        parentDeptId: keepDept,
        polygon: ring,
        areaSqf: a.areaSqf + b.areaSqf, // adjacent rooms don't overlap ⇒ areas are additive
        isLocked: false,
      }
      const out = rooms.filter((rm) => rm.roomId !== a.roomId && rm.roomId !== b.roomId)
      out.push(merged)
      const affected = a.parentDeptId === b.parentDeptId ? [a.parentDeptId] : [a.parentDeptId, b.parentDeptId]
      return { rooms: out, deptId: keepDept, affected }
    }
  }
  return null
}

/**
 * Merge a specific room (by id) with its best adjacent SAME-department neighbor — the Program
 * Sheet "Merge" row action (§3 TAB 3). Picks the touching same-dept room whose clean union has
 * the largest combined area (a real shared wall, not a corner touch). Returns null if there's no
 * eligible neighbor (e.g. it's the department's only room, or all neighbors are other depts/locked).
 */
export function mergeRoomWithNeighbor(rooms: Room[], roomId: string): { rooms: Room[]; deptId: string } | null {
  const target = rooms.find((r) => r.roomId === roomId)
  if (!target || target.isLocked) return null
  const tf = toFeat(target.polygon)

  let best: { room: Room; ring: Pt[]; area: number } | null = null
  for (const c of rooms) {
    if (c.roomId === roomId || c.isLocked) continue
    if (c.parentDeptId !== target.parentDeptId) continue
    let touches = false
    try {
      touches = turf.booleanIntersects(tf, toFeat(c.polygon))
    } catch {
      touches = false
    }
    if (!touches) continue
    let union: Feature<Polygon | MultiPolygon> | null
    try {
      union = turf.union(turf.featureCollection([tf, toFeat(c.polygon)])) as Feature<Polygon | MultiPolygon> | null
    } catch {
      continue
    }
    const ring = union ? cleanMergeRing(union) : null
    if (!ring) continue
    let area = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y)
    }
    area = Math.abs(area) / 2
    if (!best || area > best.area) best = { room: c, ring, area }
  }
  if (!best) return null

  const merged: Room = {
    roomId: target.roomId,
    parentDeptId: target.parentDeptId,
    polygon: best.ring,
    areaSqf: target.areaSqf + best.room.areaSqf,
    isLocked: false,
  }
  const out = rooms.filter((rm) => rm.roomId !== target.roomId && rm.roomId !== best!.room.roomId)
  out.push(merged)
  return { rooms: out, deptId: target.parentDeptId }
}
