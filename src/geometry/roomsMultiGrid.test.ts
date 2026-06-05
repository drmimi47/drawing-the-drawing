import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import type { Boundary, Department, Room } from '../types/geometry'
import { generateRooms, allocateCounts } from './rooms'
import { lotGridRegions } from './lotGrid'

/** True if (x,y) lies inside any room polygon (rooms share walls → a point on the seam wall
 *  must belong to at least one room; the seam gap bug left such points uncovered). */
const coveredByARoom = (rooms: Room[], x: number, y: number) =>
  rooms.some((r) =>
    turf.booleanPointInPolygon(turf.point([x, y]), turf.polygon([[...r.polygon, r.polygon[0]].map((p) => [p.x, p.y])])),
  )

/**
 * Multi-orientation room clustering: when a department spans more than one structural-grid
 * region (the user drew seams that gave the lot regions at different orientations), the
 * department's rooms must form one CLUSTER per region — each running true to its own grid —
 * instead of a single block sliced in one orientation across the seam.
 */

const dept = (over: Partial<Department> = {}): Department => ({
  id: 'A', name: 'A', x: 150, y: 150, radius: 400, color: '#3366cc', roomCount: 6, ...over,
})

const squareLot = (size: number): Boundary => ({
  ring: [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }],
  isClosed: true,
})

const bbox = (poly: { x: number; y: number }[]) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, maxX, minY, maxY }
}

describe('allocateCounts', () => {
  it('splits proportionally and sums to n when n ≥ cells', () => {
    expect(allocateCounts([100, 100], 6)).toEqual([3, 3])
    expect(allocateCounts([300, 100], 8).reduce((a, b) => a + b, 0)).toBe(8)
    expect(allocateCounts([300, 100], 8)[0]).toBeGreaterThan(allocateCounts([300, 100], 8)[1])
  })

  it('gives every region at least one room even with more regions than rooms', () => {
    expect(allocateCounts([50, 50, 50], 2)).toEqual([1, 1, 1])
    expect(allocateCounts([10, 90], 1)).toEqual([1, 1])
  })

  it('handles edge inputs', () => {
    expect(allocateCounts([], 5)).toEqual([])
    expect(allocateCounts([100], 4)).toEqual([4])
  })
})

describe('generateRooms — clusters per grid region', () => {
  // A vertical seam at x=150 splits the square lot into two grid regions; one department
  // covers the whole lot.
  const seam = [[{ x: 150, y: 0 }, { x: 150, y: 300 }]]

  it('partitions a straddling department into per-region clusters (no room crosses the seam)', () => {
    const rooms = generateRooms([dept()], squareLot(300), [], null, 30, seam)
    expect(rooms.length).toBeGreaterThanOrEqual(4)

    let leftCount = 0
    let rightCount = 0
    for (const r of rooms) {
      const b = bbox(r.polygon)
      // No room may straddle the seam line (left side and right side at once).
      expect(b.minX < 140 && b.maxX > 160).toBe(false)
      if (b.maxX <= 152) leftCount++
      if (b.minX >= 148) rightCount++
    }
    expect(leftCount).toBeGreaterThan(0)
    expect(rightCount).toBeGreaterThan(0)
  })

  it('leaves NO gap/sliver at the seam — the clusters meet at a clean shared wall', () => {
    const rooms = generateRooms([dept()], squareLot(300), [], null, 30, seam)
    // Points straddling the seam line (x=150) at several heights must each sit inside a room;
    // before the fix the seam band between the two regions was left unfilled (a gap/sliver).
    for (const y of [60, 150, 240]) {
      expect(coveredByARoom(rooms, 150, y), `seam point (150, ${y}) should be inside a room`).toBe(true)
    }
  })

  it('still slices a single-region department normally (no seams)', () => {
    const rooms = generateRooms([dept({ roomCount: 4 })], squareLot(300), [], null, 30, [])
    expect(rooms.length).toBeGreaterThanOrEqual(3)
  })

  it('a department spanning two DIFFERENTLY-oriented grids gets a cluster in each', () => {
    // Pentagon: left half is axis-aligned, the right is a 45° wedge → the seam yields two
    // regions whose best-fit grids differ (ori ~0 vs ~45).
    const ring = [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 100 }, { x: 200, y: 200 }, { x: 0, y: 200 },
    ]
    const boundary: Boundary = { ring, isClosed: true }
    const pentSeam = [[{ x: 200, y: 0 }, { x: 200, y: 200 }]]

    const regions = lotGridRegions(ring, 30, pentSeam)
    expect(regions.length).toBe(2)
    const deg = regions.map((r) => (r.ori * 180) / Math.PI)
    const hasAxis = deg.some((o) => o < 8 || o > 82)
    const hasDiag = deg.some((o) => Math.abs(o - 45) < 12)
    expect(hasAxis && hasDiag, `region orientations: ${deg.map((d) => d.toFixed(0)).join(', ')}`).toBe(true)

    const rooms = generateRooms([dept({ x: 150, y: 100, radius: 600, roomCount: 6 })], boundary, [], null, 30, pentSeam)
    let left = 0
    let right = 0
    for (const r of rooms) {
      const b = bbox(r.polygon)
      expect(b.minX < 195 && b.maxX > 205).toBe(false) // no room straddles the seam at x=200
      if (b.maxX <= 202) left++
      if (b.minX >= 198) right++
    }
    expect(left).toBeGreaterThan(0)
    expect(right).toBeGreaterThan(0)
  })

  it('a straddling department COVERS the whole lot (no grid region dropped) with rooms on both sides', () => {
    // Regression guard for multi-grid robustness: even when one region barely intersects (turf
    // boolean ops can drop it), the department must still fill the entire lot across the seam —
    // not leave a region's worth of area unroomed.
    const ring = [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 100 }, { x: 200, y: 200 }, { x: 0, y: 200 },
    ]
    const boundary: Boundary = { ring, isClosed: true }
    const pentSeam = [[{ x: 200, y: 0 }, { x: 200, y: 200 }]]
    const rooms = generateRooms([dept({ x: 150, y: 100, radius: 600, roomCount: 6 })], boundary, [], null, 30, pentSeam)

    const lotArea = turf.area(turf.polygon([[...ring, ring[0]].map((p) => [p.x, p.y])]))
    const roomArea = rooms.reduce(
      (s, r) => s + turf.area(turf.polygon([[...r.polygon, r.polygon[0]].map((p) => [p.x, p.y])])),
      0,
    )
    expect(roomArea).toBeGreaterThan(0.9 * lotArea) // whole lot covered — no region left unroomed

    // And rooms exist on BOTH sides of the seam (a cluster per grid orientation).
    expect(rooms.some((r) => bbox(r.polygon).maxX <= 202)).toBe(true)
    expect(rooms.some((r) => bbox(r.polygon).minX >= 198)).toBe(true)
  })
})
