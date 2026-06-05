import { describe, it, expect } from 'vitest'
import type { Boundary, CirculationPath, Department } from '../types/geometry'
import { generateRooms } from './rooms'

/**
 * PASS 2 is a LINEAR STRIP SLICER locked to the corridor-parallel grid axis: every room must
 * be a "finger" that runs the full depth from the MAIN corridor and fronts it — never a
 * landlocked back room (which the old recursive axis-alternating splitter would produce when
 * the cell was roughly square).
 */

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

// 400×420 lot with a horizontal MAIN corridor near the bottom (band ≈ y 20–40). The workable
// piece above it (y≈40–420) is roughly square — exactly the case the old splitter mis-handled.
const lot: Boundary = {
  ring: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 420 }, { x: 0, y: 420 }],
  isClosed: true,
}
const corridor: CirculationPath = {
  id: 'c1', centerline: [{ x: -50, y: 30 }, { x: 450, y: 30 }], width: 20, tier: 'MAIN',
}
const dept = (roomCount: number): Department => ({
  id: 'A', name: 'A', x: 200, y: 230, radius: 400, color: '#3366cc', roomCount,
})

describe('PASS 2 — linear strip slicer fronts the corridor', () => {
  it('cuts perpendicular to the corridor so every room spans the full depth and fronts it', () => {
    const rooms = generateRooms([dept(4)], lot, [corridor], null, 30)
    expect(rooms.length).toBeGreaterThanOrEqual(3)

    const pieceTop = 420
    const corridorEdge = 40 // top of the corridor band
    for (const r of rooms) {
      const b = bbox(r.polygon)
      const depth = b.maxY - b.minY
      // Full-depth finger: spans most of the ~380-tall piece (not a stacked back room).
      expect(depth, `room depth ${depth.toFixed(0)}`).toBeGreaterThan(0.8 * (pieceTop - corridorEdge))
      // Fronts the corridor: its near edge sits at the corridor band.
      expect(b.minY, `room front ${b.minY.toFixed(0)}`).toBeLessThan(80)
    }
  })

  it('flips orientation when corridor-parallel would be skinny — picks the equal/less-skinny option', () => {
    // Narrow lot (240 wide × 600 tall) with the same bottom corridor. Slicing PARALLEL to the
    // corridor (vertical) would give few, skinny, full-height strips; the quality chooser must
    // instead slice the other way → ~6 wider-than-tall rooms of roughly equal size.
    const narrow: Boundary = {
      ring: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 600 }, { x: 0, y: 600 }],
      isClosed: true,
    }
    const deptN: Department = { id: 'A', name: 'A', x: 120, y: 320, radius: 400, color: '#3366cc', roomCount: 6 }
    const rooms = generateRooms([deptN], narrow, [corridor], null, 30)
    expect(rooms.length).toBeGreaterThanOrEqual(5) // hit (near) the target count, not capped to a few
    for (const r of rooms) {
      const b = bbox(r.polygon)
      expect(b.maxX - b.minX, 'room should be wider than tall (not a skinny finger)').toBeGreaterThan(b.maxY - b.minY)
    }
  })

  it('the strips partition ALONG the corridor (vertical walls tile the width)', () => {
    const rooms = generateRooms([dept(4)], lot, [corridor], null, 30)
    // Rooms stack side-by-side across x; together they should cover most of the 400 width.
    const minX = Math.min(...rooms.map((r) => bbox(r.polygon).minX))
    const maxX = Math.max(...rooms.map((r) => bbox(r.polygon).maxX))
    expect(maxX - minX).toBeGreaterThan(0.8 * 400)
    // And each room is narrower than it is deep (a finger, not a slab).
    for (const r of rooms) {
      const b = bbox(r.polygon)
      expect(b.maxX - b.minX).toBeLessThan(b.maxY - b.minY)
    }
  })
})
