import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import type { Boundary, Department, Room } from '../types/geometry'
import { generateRooms } from './rooms'

/**
 * GRAIN drives room generation: a department's `grain ∈ [0,1]` (0 = open-plan, 1 = cellular)
 * sets a target average room area, and the engine derives the effective room count from the
 * department's footprint area. So at a fixed grain a bigger department yields more rooms, and
 * at a fixed size a higher grain yields more rooms.
 *
 * LOCKED ROOMS are keep-outs: passing them to generateRooms removes their area from the
 * workable space so freshly generated rooms reflow around them (no overlap).
 */

const squareLot = (size: number): Boundary => ({
  ring: [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }],
  isClosed: true,
})

const grainDept = (size: number, grain: number): Department => ({
  id: 'A', name: 'A', x: size / 2, y: size / 2, radius: size, color: '#3366cc', grain,
})

describe('generateRooms — grain → effective count', () => {
  it('a higher grain yields more rooms than a lower grain (same department)', () => {
    const open = generateRooms([grainDept(600, 0.1)], squareLot(600), [], null, 30)
    const cellular = generateRooms([grainDept(600, 0.9)], squareLot(600), [], null, 30)
    expect(cellular.length).toBeGreaterThan(open.length)
  })

  it('a bigger department yields more rooms than a smaller one at the same grain', () => {
    const small = generateRooms([grainDept(300, 0.5)], squareLot(300), [], null, 30)
    const big = generateRooms([grainDept(600, 0.5)], squareLot(600), [], null, 30)
    expect(big.length).toBeGreaterThan(small.length)
  })

  it('grain 0 (open-plan / monolithic) stays sparse — a couple of rooms at most', () => {
    const rooms = generateRooms([grainDept(400, 0)], squareLot(400), [], null, 30)
    expect(rooms.length).toBeGreaterThanOrEqual(1)
    expect(rooms.length).toBeLessThanOrEqual(2)
  })

  it('a grain-only department (no roomCount) still generates rooms', () => {
    const rooms = generateRooms([grainDept(400, 0.5)], squareLot(400), [], null, 30)
    expect(rooms.length).toBeGreaterThanOrEqual(2)
  })
})

describe('generateRooms — locked rooms are keep-outs', () => {
  const lockSquare = (): Room => ({
    roomId: 'L',
    parentDeptId: 'A',
    polygon: [{ x: 250, y: 250 }, { x: 350, y: 250 }, { x: 350, y: 350 }, { x: 250, y: 350 }],
    areaSqf: 10000,
    isLocked: true,
  })

  it('no freshly generated room overlaps a locked room', () => {
    const locked = lockSquare()
    const fresh = generateRooms([grainDept(600, 0.8)], squareLot(600), [], null, 30, [], [locked])
    const lockFeat = turf.polygon([[...locked.polygon, locked.polygon[0]].map((p) => [p.x, p.y])])

    for (const r of fresh) {
      const f = turf.polygon([[...r.polygon, r.polygon[0]].map((p) => [p.x, p.y])])
      const inter = turf.intersect(turf.featureCollection([f, lockFeat]))
      const overlap = inter ? turf.area(inter) : 0
      // Allow a hair of numerical slop on the shared border, but no real overlap.
      expect(overlap).toBeLessThan(50)
    }
  })

  it('removing the keep-out lets rooms fill the whole lot again', () => {
    const withLock = generateRooms([grainDept(600, 0.8)], squareLot(600), [], null, 30, [], [lockSquare()])
    const withoutLock = generateRooms([grainDept(600, 0.8)], squareLot(600), [], null, 30, [], [])
    const areaOf = (rooms: Room[]) =>
      rooms.reduce((s, r) => s + turf.area(turf.polygon([[...r.polygon, r.polygon[0]].map((p) => [p.x, p.y])])), 0)
    expect(areaOf(withoutLock)).toBeGreaterThan(areaOf(withLock))
  })
})
