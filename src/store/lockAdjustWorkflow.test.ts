import { describe, it, expect, beforeEach } from 'vitest'
import { useDrawingStore } from './drawingStore'
import type { Department, IntentPin, Room } from '../types/geometry'

/**
 * Lock ⇄ Adjust workflow: a room locked with the Lock tool must be shielded from the Intent
 * "Adjust" — whether it was locked BEFORE or AFTER an Adjust — so the user can freely alternate
 * between locking rooms and re-adjusting.
 */

const SIZE = 400
const ring = [{ x: 0, y: 0 }, { x: SIZE, y: 0 }, { x: SIZE, y: SIZE }, { x: 0, y: SIZE }]
const densityPin: IntentPin = { id: 'd', x: 200, y: 200, radius: 400, intentType: 'DENSITY' }
const dept: Department = { id: 'A', name: 'A', x: 200, y: 200, radius: 300, color: '#39c', roomCount: 4 }

const centroid = (r: Room) => {
  let x = 0
  let y = 0
  for (const p of r.polygon) {
    x += p.x
    y += p.y
  }
  return { x: x / r.polygon.length, y: y / r.polygon.length }
}

beforeEach(() => {
  useDrawingStore.setState({ departments: [], rooms: [], intentPins: [], boundary: null, activeLayer: 'CONTEXT' })
  const st = useDrawingStore.getState()
  st.setContext('BLANK')
  st.setBoundary(ring)
  useDrawingStore.setState({ departments: [dept], intentPins: [densityPin] })
  useDrawingStore.getState().setActiveLayer('ROOMS') // generate rooms
})

describe('lock ⇄ adjust', () => {
  it('a room locked BEFORE Adjust keeps its geometry through it', () => {
    const rooms0 = useDrawingStore.getState().rooms
    expect(rooms0.length).toBeGreaterThan(0)
    const c = centroid(rooms0[0])
    useDrawingStore.getState().toggleRoomLockAt(c.x, c.y)

    const locked = useDrawingStore.getState().rooms.find((r) => r.isLocked)!
    const id = locked.roomId
    const poly = locked.polygon

    useDrawingStore.getState().applyIntentToRooms() // density ⇒ more rooms

    const after = useDrawingStore.getState().rooms.find((r) => r.roomId === id)
    expect(after, 'locked room survives Adjust').toBeDefined()
    expect(after!.isLocked).toBe(true)
    expect(after!.polygon).toEqual(poly) // untouched geometry
  })

  it('a room locked AFTER an Adjust is shielded from the next Adjust (back-and-forth)', () => {
    useDrawingStore.getState().applyIntentToRooms() // first adjust, no locks

    const rooms1 = useDrawingStore.getState().rooms
    const c = centroid(rooms1[0])
    useDrawingStore.getState().toggleRoomLockAt(c.x, c.y)
    const id = useDrawingStore.getState().rooms.find((r) => r.isLocked)!.roomId
    const poly = useDrawingStore.getState().rooms.find((r) => r.roomId === id)!.polygon

    useDrawingStore.getState().applyIntentToRooms() // adjust again

    const after = useDrawingStore.getState().rooms.find((r) => r.roomId === id)
    expect(after?.isLocked).toBe(true)
    expect(after!.polygon).toEqual(poly)
  })
})
