import { describe, it, expect, beforeEach } from 'vitest'
import { useDrawingStore } from './drawingStore'
import { getEditTargets } from '../geometry/editTargets'
import type { Department } from '../types/geometry'

/**
 * Drives the REAL store through the Edit-tool pipeline for departments and rooms under
 * both substrates (BLANK / MAP). Mirrors what useVectorEdit does on pointer down/move,
 * minus R3F: pick a target via getEditTargets, then apply via the store action.
 *
 * Reported bug: dept pins won't move at all; room vertices won't move on the Blank
 * Sheet substrate. These tests assert the store path actually mutates the geometry.
 */

const SIZE = 800
function squareRing(size: number) {
  return [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }]
}
function twoDepts(size: number): Department[] {
  const q = size / 4
  return [
    { id: 'A', name: 'A', x: q, y: size / 2, radius: size / 3, color: '#f00', roomCount: 2 },
    { id: 'B', name: 'B', x: size - q, y: size / 2, radius: size / 3, color: '#00f', roomCount: 2 },
  ]
}

/** Reset to a clean world, choose a substrate, lay down a lot + two departments. */
function seed(context: 'BLANK' | 'MAP') {
  // Clear the singleton store's per-document geometry between cases.
  useDrawingStore.setState({ departments: [], rooms: [], boundary: null, activeLayer: 'CONTEXT' })
  const st = useDrawingStore.getState()
  st.setContext(context)
  st.setGeoScale(context === 'MAP' ? 0.3 : null) // metersPerWorldUnit, as a map import would set
  st.setBoundary(squareRing(SIZE))
  // Inject departments directly (the dept tool would do this interactively).
  useDrawingStore.setState({ departments: twoDepts(SIZE) })
}

describe.each(['BLANK', 'MAP'] as const)('Edit pipeline — %s substrate', (context) => {
  beforeEach(() => seed(context))

  it('moves a department pin to a new position', () => {
    useDrawingStore.getState().setActiveLayer('DEPARTMENTS')
    const st = useDrawingStore.getState()
    const { points } = getEditTargets('DEPARTMENTS', st.graph, st.boundary, st.circulationPaths, st.intentPins, st.departments, st.rooms)
    const handle = points.find((p) => p.key === 'dept:A')
    expect(handle, 'department A should expose an edit handle').toBeTruthy()

    const nx = handle!.x + 50
    const ny = handle!.y + 30
    useDrawingStore.getState().setDepartmentPoint('A', nx, ny)

    const moved = useDrawingStore.getState().departments.find((d) => d.id === 'A')!
    expect(moved.x).toBeCloseTo(nx)
    expect(moved.y).toBeCloseTo(ny)
  })

  it('generates rooms on entering the Rooms layer and moves a room vertex', () => {
    useDrawingStore.getState().setActiveLayer('ROOMS')
    const rooms = useDrawingStore.getState().rooms
    expect(rooms.length, 'rooms should generate from departments with roomCount').toBeGreaterThanOrEqual(3)

    const st = useDrawingStore.getState()
    const { points } = getEditTargets('ROOMS', st.graph, st.boundary, st.circulationPaths, st.intentPins, st.departments, st.rooms)
    expect(points.length, 'room vertices should expose edit handles').toBeGreaterThan(0)

    // Grab the first room's first vertex, nudge it inward, and apply via the store.
    const target = points[0]
    const [, roomId, idxStr] = target.key.split(':')
    const idx = Number(idxStr)
    const before = { ...st.rooms.find((r) => r.roomId === roomId)!.polygon[idx] }

    const weld = 2
    useDrawingStore.getState().beginRoomCornerDrag(target.x, target.y, weld)
    const nx = target.x + 1
    const ny = target.y + 1
    useDrawingStore.getState().setRoomVertices([{ roomId, index: idx, x: nx, y: ny }])

    const after = useDrawingStore.getState().rooms.find((r) => r.roomId === roomId)!.polygon[idx]
    expect(after.x !== before.x || after.y !== before.y, 'room vertex should have moved').toBe(true)
  })
})
