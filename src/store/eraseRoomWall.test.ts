import { describe, it, expect, beforeEach } from 'vitest'
import { useDrawingStore } from './drawingStore'
import type { Department, Room } from '../types/geometry'

/**
 * eraseRoomWallAt (Rooms-layer wall eraser): merges the two same-department rooms sharing the
 * wall under the point, drops the department's room count to match, and only runs on the Rooms
 * layer.
 */

const dept = (id: string): Department => ({
  id, name: id, x: 100, y: 50, radius: 80, color: '#3366cc', grain: 0.5,
})

const room = (id: string, x0: number, x1: number): Room => ({
  roomId: id,
  parentDeptId: 'D1',
  polygon: [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 100 }, { x: x0, y: 100 }],
  areaSqf: (x1 - x0) * 100,
  isLocked: false,
})

beforeEach(() => {
  useDrawingStore.setState({
    activeLayer: 'ROOMS',
    departments: [dept('D1')],
    rooms: [room('a', 0, 100), room('b', 100, 200), room('c', 200, 300)],
  })
})

describe('eraseRoomWallAt', () => {
  it('merges the two rooms at the wall and updates the department count', () => {
    const ok = useDrawingStore.getState().eraseRoomWallAt(100, 50, 10)
    expect(ok).toBe(true)
    const st = useDrawingStore.getState()
    const d1Rooms = st.rooms.filter((r) => r.parentDeptId === 'D1')
    expect(d1Rooms.length).toBe(2) // was 3
    // Department target pinned to the new count, grain cleared (now a manual layout).
    const d1 = st.departments.find((d) => d.id === 'D1')!
    expect(d1.roomCount).toBe(2)
    expect(d1.grain).toBeUndefined()
  })

  it('no-ops off the Rooms layer', () => {
    useDrawingStore.setState({ activeLayer: 'DEPARTMENTS' })
    expect(useDrawingStore.getState().eraseRoomWallAt(100, 50, 10)).toBe(false)
    expect(useDrawingStore.getState().rooms.length).toBe(3)
  })

  it('no-ops when not over a wall', () => {
    expect(useDrawingStore.getState().eraseRoomWallAt(50, 50, 8)).toBe(false)
    expect(useDrawingStore.getState().rooms.length).toBe(3)
  })
})
