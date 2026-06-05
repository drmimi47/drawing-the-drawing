import * as turf from '@turf/turf'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { polygonAreaWorld, worldAreaToSqft } from './area'
import { dominantLotOrientation } from './lotGrid'
import type { Boundary, Room } from '../types/geometry'

/**
 * Manual "Split Room" (document_int.txt §3 TAB 3 / Stage 4.4): bisect a single room into two
 * equal-area halves with one straight, GRID-ALIGNED cut (perpendicular to the room's longer
 * extent in the lot's dominant grid frame), so the two halves run true to the structural grid.
 */

type Pt = { x: number; y: number }
type PolyFeature = Feature<Polygon | MultiPolygon>

function toFeat(ring: Pt[]): Feature<Polygon> {
  const c = ring.map((p) => [p.x, p.y])
  c.push([ring[0].x, ring[0].y])
  return turf.polygon([c])
}

function outerRing(f: PolyFeature | null): Pt[] | null {
  if (!f || f.geometry.type !== 'Polygon') return null
  const coords = f.geometry.coordinates[0].map(([x, y]) => ({ x, y }))
  if (coords.length > 1) {
    const a = coords[0]
    const b = coords[coords.length - 1]
    if (a.x === b.x && a.y === b.y) coords.pop()
  }
  return coords.length >= 3 ? coords : null
}

const proj = (p: Pt, dir: Pt) => p.x * dir.x + p.y * dir.y

function extentAlong(ring: Pt[], dir: Pt): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const p of ring) {
    const u = proj(p, dir)
    if (u < lo) lo = u
    if (u > hi) hi = u
  }
  return [lo, hi]
}

function diff(a: PolyFeature, b: PolyFeature): PolyFeature | null {
  try {
    return (turf.difference(turf.featureCollection([a, b])) as PolyFeature | null) ?? null
  } catch {
    return null
  }
}

/** A large rectangle covering the half-space { p·dir < c } (below) or { p·dir > c } (above). */
function halfPlaneBox(span: number, dir: Pt, c: number, below: boolean): Feature<Polygon> {
  const n = { x: -dir.y, y: dir.x } // perpendicular axis
  const far = span * 3
  const a = below ? c - far : c
  const b = below ? c : c + far
  const pt = (u: number, v: number): number[] => [dir.x * u + n.x * v, dir.y * u + n.y * v]
  const ring = [pt(a, -far), pt(b, -far), pt(b, far), pt(a, far)]
  ring.push(ring[0])
  return turf.polygon([ring])
}

/** Clip a polygon to the oriented slab { c0 ≤ p·dir ≤ c1 } by removing the two outside halves. */
function clipSlab(room: PolyFeature, dir: Pt, c0: number, c1: number, span: number): PolyFeature | null {
  let f: PolyFeature | null = diff(room, halfPlaneBox(span, dir, c0, true)) // drop below c0
  if (!f) return null
  f = diff(f, halfPlaneBox(span, dir, c1, false)) // drop above c1
  return f
}

/** Binary-search the cut along `dir` where the area below equals `half`. */
function halfAreaCut(room: PolyFeature, dir: Pt, lo: number, hi: number, half: number, span: number): number {
  let a = lo
  let b = hi
  for (let i = 0; i < 24; i++) {
    const m = (a + b) / 2
    const low = clipSlab(room, dir, lo, m, span)
    const area = low ? polygonAreaWorld(outerRing(low) ?? []) : 0
    if (area < half) a = m
    else b = m
  }
  return (a + b) / 2
}

export interface SplitRoomResult {
  a: Room
  b: Room
}

/** Split `room` into two equal-area, grid-aligned halves. Returns null if it can't (too small). */
export function splitRoom(
  room: Room,
  boundary: Boundary | null,
  mpu: number | null,
  idA: string,
  idB: string,
): SplitRoomResult | null {
  if (room.polygon.length < 3) return null
  const dom = boundary && boundary.ring.length >= 3 ? dominantLotOrientation(boundary.ring) : null
  const ori = dom ? dom.ori : 0
  const dirA: Pt = { x: Math.cos(ori), y: Math.sin(ori) }
  const dirB: Pt = { x: -dirA.y, y: dirA.x }
  const [a0, a1] = extentAlong(room.polygon, dirA)
  const [b0, b1] = extentAlong(room.polygon, dirB)
  // Cut perpendicular to the LONGER extent (so each half stays more square).
  const cutDir = a1 - a0 >= b1 - b0 ? dirA : dirB
  const [lo, hi] = extentAlong(room.polygon, cutDir)
  if (hi - lo < 1e-3) return null

  const feat = toFeat(room.polygon) as PolyFeature
  const [bx0, by0, bx1, by1] = turf.bbox(feat)
  const span = Math.max(bx1 - bx0, by1 - by0) + 10
  const total = polygonAreaWorld(room.polygon)
  const cut = halfAreaCut(feat, cutDir, lo, hi, total / 2, span)

  const ringA = outerRing(clipSlab(feat, cutDir, lo, cut, span))
  const ringB = outerRing(clipSlab(feat, cutDir, cut, hi, span))
  if (!ringA || !ringB) return null

  const mk = (id: string, ring: Pt[]): Room => {
    const w = polygonAreaWorld(ring)
    return {
      roomId: id,
      parentDeptId: room.parentDeptId,
      polygon: ring,
      areaSqf: mpu != null && mpu > 0 ? worldAreaToSqft(w, mpu) : w,
      isLocked: false,
    }
  }
  return { a: mk(idA, ringA), b: mk(idB, ringB) }
}
