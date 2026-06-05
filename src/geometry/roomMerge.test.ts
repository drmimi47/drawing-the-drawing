import { describe, it, expect } from 'vitest'
import type { Room } from '../types/geometry'
import { mergeRoomsAtWall, mergeRoomWithNeighbor } from './roomMerge'

/**
 * Erasing a wall merges the two SAME-department rooms it divides into one (count drops, the
 * survivor fills the space). It must not merge across departments, over a boundary/outer wall,
 * or a locked room.
 */

const room = (id: string, dept: string, x0: number, x1: number, locked = false): Room => ({
  roomId: id,
  parentDeptId: dept,
  polygon: [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 100 }, { x: x0, y: 100 }],
  areaSqf: (x1 - x0) * 100,
  isLocked: locked,
})

describe('mergeRoomsAtWall', () => {
  it('merges two adjacent same-department rooms across the erased wall', () => {
    const rooms = [room('a', 'D1', 0, 100), room('b', 'D1', 100, 200)]
    const res = mergeRoomsAtWall(rooms, 100, 50, 10)
    expect(res).not.toBeNull()
    expect(res!.deptId).toBe('D1')
    expect(res!.rooms.length).toBe(1)
    expect(res!.rooms[0].areaSqf).toBe(20000) // areas add up
    // The merged room spans the full 0..200 width (the wall is gone).
    const xs = res!.rooms[0].polygon.map((p) => p.x)
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(200)
  })

  it('merges across departments too (survivor keeps the LARGER room department)', () => {
    // a (0..100, dept D1) is larger than b (100..160, dept D2); merging keeps D1.
    const rooms = [room('a', 'D1', 0, 100), room('b', 'D2', 100, 160)]
    const res = mergeRoomsAtWall(rooms, 100, 50, 10)
    expect(res).not.toBeNull()
    expect(res!.rooms.length).toBe(1)
    expect(res!.rooms[0].parentDeptId).toBe('D1')
    expect(res!.deptId).toBe('D1')
    expect(res!.affected.sort()).toEqual(['D1', 'D2'])
  })

  it('still merges genuinely-adjacent rooms despite a hairline float gap on the shared edge', () => {
    const a = room('a', 'D1', 0, 100)
    // b starts a sub-thousandth past a's right edge (float noise) — must still merge.
    const b: Room = {
      roomId: 'b', parentDeptId: 'D1', isLocked: false, areaSqf: 10000,
      polygon: [{ x: 100.0002, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100.0002, y: 100 }],
    }
    const res = mergeRoomsAtWall([a, b], 100, 50, 10)
    expect(res).not.toBeNull()
    expect(res!.rooms.length).toBe(1)
  })

  it('does NOT merge across a locked room', () => {
    const rooms = [room('a', 'D1', 0, 100, true), room('b', 'D1', 100, 200)]
    expect(mergeRoomsAtWall(rooms, 100, 50, 10)).toBeNull()
  })

  it('returns null over an outer wall with no neighbor', () => {
    const rooms = [room('a', 'D1', 0, 100), room('b', 'D1', 100, 200)]
    // A point on the far-left outer edge touches only room a — no shared wall to erase.
    expect(mergeRoomsAtWall(rooms, 0, 50, 8)).toBeNull()
  })

  it('returns null when the eraser is nowhere near a wall', () => {
    const rooms = [room('a', 'D1', 0, 100), room('b', 'D1', 100, 200)]
    expect(mergeRoomsAtWall(rooms, 50, 50, 8)).toBeNull()
  })
})

describe('mergeRoomWithNeighbor (sheet row action)', () => {
  it('merges a room into its adjacent same-department neighbor', () => {
    const rooms = [room('a', 'D1', 0, 100), room('b', 'D1', 100, 200)]
    const res = mergeRoomWithNeighbor(rooms, 'a')
    expect(res).not.toBeNull()
    expect(res!.rooms.length).toBe(1)
    expect(res!.rooms[0].areaSqf).toBe(20000)
  })

  it('returns null for a department with no adjacent neighbor', () => {
    const rooms = [room('a', 'D1', 0, 100), room('b', 'D2', 100, 200)] // different dept
    expect(mergeRoomWithNeighbor(rooms, 'a')).toBeNull()
  })

  it('returns null for a locked room', () => {
    const rooms = [room('a', 'D1', 0, 100, true), room('b', 'D1', 100, 200)]
    expect(mergeRoomWithNeighbor(rooms, 'a')).toBeNull()
  })
})
