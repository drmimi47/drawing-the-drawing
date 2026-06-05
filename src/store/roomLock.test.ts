import { describe, it, expect, beforeEach } from 'vitest'
import { useDrawingStore } from './drawingStore'
import type { Department } from '../types/geometry'

/**
 * Per-room locking: a locked room is frozen (survives every regeneration) and becomes a
 * keep-out the unlocked rooms reflow around. Toggling a lock does NOT itself reflow. Every
 * regeneration path (grain change, manual count, department remove/erase) must preserve locks.
 */

const SIZE = 800
const ring = [{ x: 0, y: 0 }, { x: SIZE, y: 0 }, { x: SIZE, y: SIZE }, { x: 0, y: SIZE }]

const dept = (id: string, x: number, extra: Partial<Department> = {}): Department => ({
  id, name: id, x, y: SIZE / 2, radius: SIZE / 3, color: '#3366cc', grain: 0.6, ...extra,
})

const enterRoomsWith = (depts: Department[]) => {
  useDrawingStore.setState({ departments: [], rooms: [], boundary: null, activeLayer: 'CONTEXT' })
  const st = useDrawingStore.getState()
  st.setContext('BLANK')
  st.setBoundary(ring)
  useDrawingStore.setState({ departments: depts })
  useDrawingStore.getState().setActiveLayer('ROOMS')
}

beforeEach(() => {
  enterRoomsWith([dept('A', 250), dept('B', 550)])
})

const firstLockedRoomId = () => {
  const id = useDrawingStore.getState().rooms[0].roomId
  useDrawingStore.getState().toggleRoomLock(id)
  return id
}

describe('toggleRoomLock', () => {
  it('flips a room lock without regenerating (same room set)', () => {
    const before = useDrawingStore.getState().rooms.map((r) => r.roomId)
    const id = before[0]
    useDrawingStore.getState().toggleRoomLock(id)
    const after = useDrawingStore.getState().rooms
    expect(after.map((r) => r.roomId)).toEqual(before) // no reflow
    expect(after.find((r) => r.roomId === id)!.isLocked).toBe(true)
    useDrawingStore.getState().toggleRoomLock(id)
    expect(useDrawingStore.getState().rooms.find((r) => r.roomId === id)!.isLocked).toBe(false)
  })

  it('clearRoomLocks unlocks everything', () => {
    firstLockedRoomId()
    expect(useDrawingStore.getState().rooms.some((r) => r.isLocked)).toBe(true)
    useDrawingStore.getState().clearRoomLocks()
    expect(useDrawingStore.getState().rooms.some((r) => r.isLocked)).toBe(false)
  })
})

describe('locked rooms survive every regeneration path', () => {
  it('setDeptGrain preserves the locked room', () => {
    const id = firstLockedRoomId()
    useDrawingStore.getState().setDeptGrain('B', 0.9)
    const locked = useDrawingStore.getState().rooms.find((r) => r.roomId === id)
    expect(locked).toBeDefined()
    expect(locked!.isLocked).toBe(true)
  })

  it('setRoomCount preserves the locked room', () => {
    const id = firstLockedRoomId()
    useDrawingStore.getState().setRoomCount('B', 3)
    expect(useDrawingStore.getState().rooms.find((r) => r.roomId === id)?.isLocked).toBe(true)
  })

  it('removeDepartment preserves a locked room from another department', () => {
    // Lock a room belonging to A, then remove B.
    const rooms = useDrawingStore.getState().rooms
    const aRoom = rooms.find((r) => r.parentDeptId === 'A')!
    useDrawingStore.getState().toggleRoomLock(aRoom.roomId)
    useDrawingStore.getState().removeDepartment('B')
    expect(useDrawingStore.getState().rooms.find((r) => r.roomId === aRoom.roomId)?.isLocked).toBe(true)
  })
})
