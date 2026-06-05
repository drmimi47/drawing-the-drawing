import { describe, it, expect, beforeEach } from 'vitest'
import { useDrawingStore } from './drawingStore'
import type { CirculationPath, Department, Room } from '../types/geometry'

/**
 * Rooms are DERIVED: moving a department pin (on the Departments layer) or editing circulation
 * must re-flow the rooms when the user returns to the Rooms layer — the entry cascade re-derives
 * rooms from the current boundary + circulation + department positions.
 */

const SIZE = 400
const ring = [{ x: 0, y: 0 }, { x: SIZE, y: 0 }, { x: SIZE, y: SIZE }, { x: 0, y: SIZE }]

const dept = (id: string, x: number, y: number): Department => ({
  id, name: id, x, y, radius: 120, color: '#3366cc', roomCount: 4,
})

const mainCorridorY = (y: number, width = 20): CirculationPath => ({
  id: `c-${y}`, centerline: [{ x: -50, y }, { x: SIZE + 50, y }], width, tier: 'MAIN',
})

const cY = (r: Room) => r.polygon.reduce((s, p) => s + p.y, 0) / r.polygon.length
const totalArea = (rooms: Room[]) =>
  rooms.reduce((s, r) => {
    let a = 0
    for (let i = 0, j = r.polygon.length - 1; i < r.polygon.length; j = i++) {
      a += (r.polygon[j].x + r.polygon[i].x) * (r.polygon[j].y - r.polygon[i].y)
    }
    return s + Math.abs(a) / 2
  }, 0)

beforeEach(() => {
  useDrawingStore.setState({
    departments: [], rooms: [], circulationPaths: [], boundary: null, activeLayer: 'CONTEXT',
  })
  const st = useDrawingStore.getState()
  st.setContext('BLANK')
  st.setBoundary(ring)
})

describe('rooms re-flow when upstream layers change', () => {
  it('moving a department pin re-flows its rooms on Rooms re-entry', () => {
    // A MAIN corridor splits the lot into a top and a bottom piece.
    useDrawingStore.setState({ circulationPaths: [mainCorridorY(200)] })
    useDrawingStore.setState({ departments: [dept('A', 200, 300)] }) // pin in the TOP piece
    useDrawingStore.getState().setActiveLayer('ROOMS')

    const topRooms = useDrawingStore.getState().rooms
    expect(topRooms.length).toBeGreaterThan(0)
    expect(topRooms.every((r) => cY(r) > 200)).toBe(true) // all rooms in the top piece

    // Go back, move the pin into the BOTTOM piece, return to Rooms.
    useDrawingStore.getState().setActiveLayer('DEPARTMENTS')
    useDrawingStore.getState().setDepartmentPoint('A', 200, 100)
    useDrawingStore.getState().setActiveLayer('ROOMS')

    const bottomRooms = useDrawingStore.getState().rooms
    expect(bottomRooms.length).toBeGreaterThan(0)
    expect(bottomRooms.every((r) => cY(r) < 200)).toBe(true) // rooms followed the pin to the bottom
  })

  it('adding a MAIN corridor re-flows (carves) the rooms on Rooms re-entry', () => {
    useDrawingStore.setState({ departments: [dept('A', 200, 200)] })
    useDrawingStore.getState().setActiveLayer('ROOMS')
    const before = totalArea(useDrawingStore.getState().rooms)
    expect(before).toBeGreaterThan(0)

    // Add a wide MAIN corridor on the Circulation layer, then return to Rooms.
    useDrawingStore.getState().setActiveLayer('CIRCULATION')
    useDrawingStore.setState({ circulationPaths: [mainCorridorY(200, 60)] })
    useDrawingStore.getState().setActiveLayer('ROOMS')

    const after = totalArea(useDrawingStore.getState().rooms)
    expect(after).toBeLessThan(before) // the corridor band is carved out of the room area
  })
})
