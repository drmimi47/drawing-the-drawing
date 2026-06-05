// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// useVectorEdit pulls the camera from R3F's useThree; mock it so the hook runs outside a
// <Canvas>. Everything else (store, geometry) is the real implementation.
vi.mock('@react-three/fiber', () => ({
  useThree: () => ({ camera: { zoom: 1 } }),
}))

import { useVectorEdit } from './useVectorEdit'
import { useDrawingStore } from '../store/drawingStore'
import type { Department } from '../types/geometry'

/** Synthetic R3F pointer event at world point (x,y), left button. */
function evt(x: number, y: number) {
  return {
    point: { x, y },
    nativeEvent: {
      button: 0,
      pointerId: 1,
      shiftKey: false,
      target: { setPointerCapture: () => {} },
    },
  } as never
}

const dept = (over: Partial<Department> = {}): Department => ({
  id: 'A', name: 'A', x: 400, y: 300, radius: 120, color: '#f00', ...over,
})

beforeEach(() => {
  useDrawingStore.setState({ departments: [], rooms: [], boundary: null })
  const st = useDrawingStore.getState()
  st.setContext('BLANK')
  st.setBoundary([{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }])
  useDrawingStore.setState({ departments: [dept()], activeLayer: 'DEPARTMENTS', toolMode: 'VECTOR' })
})

describe('useVectorEdit — department pin drag (hook logic)', () => {
  it('grabs the pin under the cursor and moves it on drag', () => {
    const { result } = renderHook(() => useVectorEdit())
    // Press exactly on the pin head, then drag to a new spot.
    result.current.onPointerDown(evt(400, 300))
    result.current.onPointerMove(evt(500, 360))
    result.current.onPointerUp()

    const moved = useDrawingStore.getState().departments.find((d) => d.id === 'A')!
    expect(moved.x).toBeCloseTo(500)
    expect(moved.y).toBeCloseTo(360)
  })

  it('does nothing when the press misses every pin', () => {
    const { result } = renderHook(() => useVectorEdit())
    result.current.onPointerDown(evt(50, 50)) // far from the pin at (400,300)
    result.current.onPointerMove(evt(120, 90))
    result.current.onPointerUp()

    const same = useDrawingStore.getState().departments.find((d) => d.id === 'A')!
    expect(same.x).toBe(400)
    expect(same.y).toBe(300)
  })
})
