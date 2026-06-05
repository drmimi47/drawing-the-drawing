import { describe, it, expect } from 'vitest'
import type { Boundary, Department, Room } from '../types/geometry'
import { generateRooms } from './rooms'

/**
 * PASS 1 department reconciliation: the border between two adjacent departments must be a clean,
 * GRID-ALIGNED straight line that actually separates them (cut perpendicular to the axis they're
 * spread on) — not a cut along the region's longer side that mis-splits a stacked pair.
 */

const square = (size: number): Boundary => ({
  ring: [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }],
  isClosed: true,
})

const dept = (id: string, x: number, y: number): Department => ({
  id, name: id, x, y, radius: 150, color: '#3366cc', roomCount: 2,
})

const cY = (r: Room) => r.polygon.reduce((s, p) => s + p.y, 0) / r.polygon.length
const cX = (r: Room) => r.polygon.reduce((s, p) => s + p.x, 0) / r.polygon.length
const bb = (r: Room) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of r.polygon) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, maxX, minY, maxY }
}

describe('two adjacent departments reconcile on a grid-aligned border', () => {
  it('VERTICALLY stacked departments split on a horizontal line (no interleaving)', () => {
    const rooms = generateRooms([dept('A', 200, 80), dept('B', 200, 320)], square(400), [], null, 40)
    const a = rooms.filter((r) => r.parentDeptId === 'A')
    const b = rooms.filter((r) => r.parentDeptId === 'B')
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBeGreaterThan(0)
    // Department A sits entirely below B — the border cleanly separates them (no interleaving),
    // which a cut along the region's longer side would NOT achieve for a stacked pair.
    expect(Math.max(...a.map(cY))).toBeLessThan(Math.min(...b.map(cY)))
    // The border is a single horizontal grid line: A's tops and B's bottoms meet near one y.
    const aTop = Math.max(...a.map((r) => bb(r).maxY))
    const bBot = Math.min(...b.map((r) => bb(r).minY))
    expect(Math.abs(aTop - bBot)).toBeLessThan(2) // shared straight border, no diagonal gap
  })

  it('HORIZONTALLY placed departments split on a vertical line (no interleaving)', () => {
    const rooms = generateRooms([dept('A', 80, 200), dept('B', 320, 200)], square(400), [], null, 40)
    const a = rooms.filter((r) => r.parentDeptId === 'A')
    const b = rooms.filter((r) => r.parentDeptId === 'B')
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBeGreaterThan(0)
    expect(Math.max(...a.map(cX))).toBeLessThan(Math.min(...b.map(cX)))
    const aRight = Math.max(...a.map((r) => bb(r).maxX))
    const bLeft = Math.min(...b.map((r) => bb(r).minX))
    expect(Math.abs(aRight - bLeft)).toBeLessThan(2)
  })

  it('a HEAVILY weighted neighbor does not generate the small department across the floorplan', () => {
    // A dominates by area (radius 180 vs 25). The weight-proportional cut would otherwise land
    // far past B's pin, putting B's cell at the opposite edge from its pin. The cut must stay
    // between the two pins so each department's rooms sit on its own side.
    const big: Department = { id: 'A', name: 'A', x: 60, y: 200, radius: 180, color: '#36c', roomCount: 4 }
    const small: Department = { id: 'B', name: 'B', x: 320, y: 200, radius: 25, color: '#c63', roomCount: 4 }
    const rooms = generateRooms([big, small], square(400), [], null, 40)
    const a = rooms.filter((r) => r.parentDeptId === 'A')
    const b = rooms.filter((r) => r.parentDeptId === 'B')
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBeGreaterThan(0)
    // The border lands near the gap between the pins (~x 60..320), NOT far past B's pin.
    const aRight = Math.max(...a.map((r) => bb(r).maxX))
    expect(aRight).toBeLessThan(340) // A doesn't swallow B's side of the plan
    // B's rooms sit on B's side (right of A), reaching its pin region.
    expect(Math.min(...b.map(cX))).toBeGreaterThan(Math.max(...a.map(cX)))
    expect(Math.max(...b.map((r) => bb(r).maxX))).toBeGreaterThan(320)
  })
})
