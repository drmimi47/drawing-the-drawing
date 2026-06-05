import { describe, it, expect } from 'vitest'
import type { Room } from '../types/geometry'
import { splitRoom } from './roomSplit'

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

const room: Room = {
  roomId: 'r', parentDeptId: 'D', isLocked: false, areaSqf: 10000,
  polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
}

describe('splitRoom', () => {
  it('bisects a room into two equal-area grid-aligned halves', () => {
    const res = splitRoom(room, null, null, 'a', 'b')
    expect(res).not.toBeNull()
    expect(res!.a.areaSqf).toBeCloseTo(5000, 0)
    expect(res!.b.areaSqf).toBeCloseTo(5000, 0)
    // A straight axis-aligned cut: each half keeps the full 100 height and ~50 width.
    for (const half of [res!.a, res!.b]) {
      const b = bbox(half.polygon)
      expect(b.maxY - b.minY).toBeCloseTo(100, 0)
      expect(b.maxX - b.minX).toBeCloseTo(50, 0)
    }
    expect(res!.a.parentDeptId).toBe('D')
    expect(res!.a.isLocked).toBe(false)
  })
})
