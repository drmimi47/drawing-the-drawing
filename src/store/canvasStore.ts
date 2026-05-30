import { create } from 'zustand'
import type { ViewportAABB } from '../utils/viewport'

/**
 * Transient canvas interaction state (Cluster C).
 *
 * - `isSpaceDown` / `isPanning` drive the cursor and gate drawing while panning.
 * - `viewport` is the world-space AABB of the visible area, updated each frame by
 *   `useViewport`. Cluster E (viewport observer) consumes it.
 */

interface CanvasState {
  isSpaceDown: boolean
  isPanning: boolean
  viewport: ViewportAABB

  setSpaceDown: (value: boolean) => void
  setPanning: (value: boolean) => void
  setViewport: (viewport: ViewportAABB) => void
}

export const useCanvasStore = create<CanvasState>((set) => ({
  isSpaceDown: false,
  isPanning: false,
  viewport: { minX: 0, minY: 0, maxX: 0, maxY: 0 },

  setSpaceDown: (value) => set({ isSpaceDown: value }),
  setPanning: (value) => set({ isPanning: value }),
  setViewport: (viewport) => set({ viewport }),
}))
