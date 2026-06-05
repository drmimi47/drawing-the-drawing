import { describe, it, expect, beforeEach } from 'vitest'
import { useDrawingStore } from './drawingStore'
import type { Department } from '../types/geometry'

/**
 * Entering the Rooms layer defaults every department with no room intent yet to a fixed
 * DEFAULT_ROOM_COUNT (6, a dev/testing default) so it generates rooms immediately — while
 * keeping any explicit grain or manual room count the user already set.
 */
const DEFAULT_ROOM_COUNT = 6

const SIZE = 800
const ring = [{ x: 0, y: 0 }, { x: SIZE, y: 0 }, { x: SIZE, y: SIZE }, { x: 0, y: SIZE }]

const dept = (
  id: string,
  x: number,
  extra: Partial<Department> = {},
): Department => ({
  id, name: id, x, y: SIZE / 2, radius: SIZE / 3, color: '#3366cc', ...extra,
})

beforeEach(() => {
  useDrawingStore.setState({ departments: [], rooms: [], boundary: null, activeLayer: 'CONTEXT' })
  const st = useDrawingStore.getState()
  st.setContext('BLANK')
  st.setBoundary(ring)
})

describe('Rooms layer entry — default room count', () => {
  it('defaults departments with no room intent to 6 and generates rooms', () => {
    useDrawingStore.setState({ departments: [dept('A', 250), dept('B', 550)] })
    useDrawingStore.getState().setActiveLayer('ROOMS')

    const st = useDrawingStore.getState()
    expect(st.departments.every((d) => d.roomCount === DEFAULT_ROOM_COUNT)).toBe(true)
    expect(st.rooms.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps explicit grain or manual room count the user already set', () => {
    useDrawingStore.setState({
      departments: [
        dept('A', 200, { roomCount: 2 }), // explicit manual count
        dept('B', 450, { roomCount: 0 }), // explicit zero
        dept('C', 650, { grain: 0.9 }), // explicit grain
      ],
    })
    useDrawingStore.getState().setActiveLayer('ROOMS')

    const by = (id: string) => useDrawingStore.getState().departments.find((d) => d.id === id)!
    expect(by('A').roomCount).toBe(2)
    expect(by('B').roomCount).toBe(0)
    expect(by('C').grain).toBe(0.9)
    expect(by('C').roomCount).toBeUndefined() // grain stays the control, no count seeded
  })
})
