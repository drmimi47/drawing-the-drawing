import { describe, it, expect, beforeEach } from 'vitest'
import { useDrawingStore } from './drawingStore'
import type { Department, IntentPin, Room } from '../types/geometry'

/**
 * Intent Pins replace the grain slider: applyIntentToRooms ("Adjust") nudges each department's
 * ROOM COUNT from the Density/Openness field — Density adds rooms, Openness removes them (like
 * clicking the count up/down). toggleRoomLockAt is the Lock-tool click that shields a room.
 */

const dept = (id: string, x: number, y: number, roomCount?: number): Department => ({
  id, name: id, x, y, radius: 80, color: '#39c', roomCount,
})
const pin = (intentType: IntentPin['intentType'], x: number, y: number): IntentPin => ({
  id: `${intentType}-${x}`, x, y, radius: 100, intentType,
})

beforeEach(() => {
  useDrawingStore.setState({ departments: [], rooms: [], intentPins: [], boundary: null, activeLayer: 'ROOMS' })
})

describe('applyIntentToRooms (Adjust)', () => {
  it('a Density pin INCREASES the department room count', () => {
    useDrawingStore.setState({ departments: [dept('A', 100, 100, 6)], intentPins: [pin('DENSITY', 100, 100)] })
    useDrawingStore.getState().applyIntentToRooms()
    const a = useDrawingStore.getState().departments.find((d) => d.id === 'A')!
    expect(a.roomCount!).toBeGreaterThan(6)
    expect(a.grain).toBeUndefined()
  })

  it('an Openness pin DECREASES the department room count', () => {
    useDrawingStore.setState({ departments: [dept('A', 100, 100, 6)], intentPins: [pin('OPENNESS', 100, 100)] })
    useDrawingStore.getState().applyIntentToRooms()
    const a = useDrawingStore.getState().departments.find((d) => d.id === 'A')!
    expect(a.roomCount!).toBeLessThan(6)
    expect(a.roomCount!).toBeGreaterThanOrEqual(1)
  })

  it('no pins ⇒ no change', () => {
    useDrawingStore.setState({ departments: [dept('A', 100, 100, 6)], intentPins: [] })
    useDrawingStore.getState().applyIntentToRooms()
    expect(useDrawingStore.getState().departments[0].roomCount).toBe(6)
  })
})

describe('toggleRoomLockAt (Lock tool click)', () => {
  const room: Room = {
    roomId: 'r', parentDeptId: 'A', isLocked: false, areaSqf: 10000,
    polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  }

  it('locks/unlocks the room whose interior contains the point', () => {
    useDrawingStore.setState({ rooms: [room] })
    useDrawingStore.getState().toggleRoomLockAt(50, 50)
    expect(useDrawingStore.getState().rooms[0].isLocked).toBe(true)
    useDrawingStore.getState().toggleRoomLockAt(50, 50)
    expect(useDrawingStore.getState().rooms[0].isLocked).toBe(false)
  })

  it('no-ops outside any room, and off the Rooms layer', () => {
    useDrawingStore.setState({ rooms: [room] })
    useDrawingStore.getState().toggleRoomLockAt(500, 500)
    expect(useDrawingStore.getState().rooms[0].isLocked).toBe(false)
    useDrawingStore.setState({ activeLayer: 'DEPARTMENTS' })
    useDrawingStore.getState().toggleRoomLockAt(50, 50)
    expect(useDrawingStore.getState().rooms[0].isLocked).toBe(false)
  })
})
