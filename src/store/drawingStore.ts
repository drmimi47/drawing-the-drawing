import { create } from 'zustand'

/**
 * Central canvas + tool state (Cluster B).
 *
 * Stroke/tool types live here for now; Cluster D promotes the geometry types to
 * `types/geometry.ts` when the planar graph lands.
 */

export type ToolMode = 'DRAW' | 'PAN' | 'LOCK'

/** A single point along a committed stroke. `w` is the half-width in world units. */
export interface StrokePoint {
  x: number
  y: number
  w: number
}

export interface Stroke {
  id: string
  color: string
  points: StrokePoint[]
}

interface DrawingState {
  toolMode: ToolMode
  strokeColor: string
  /** Nominal stroke width in world units (1 world unit = 1px at zoom 1). */
  baseWidth: number
  strokes: Stroke[]

  setTool: (tool: ToolMode) => void
  setColor: (color: string) => void
  setBaseWidth: (width: number) => void
  addStroke: (stroke: Stroke) => void
  undo: () => void
  clear: () => void
}

let strokeCounter = 0
export const nextStrokeId = (): string => `stroke-${Date.now()}-${strokeCounter++}`

export const useDrawingStore = create<DrawingState>((set) => ({
  toolMode: 'DRAW',
  strokeColor: '#1a1a1a',
  baseWidth: 3.5,
  strokes: [],

  setTool: (tool) => set({ toolMode: tool }),
  setColor: (color) => set({ strokeColor: color }),
  setBaseWidth: (width) => set({ baseWidth: width }),
  addStroke: (stroke) => set((state) => ({ strokes: [...state.strokes, stroke] })),
  undo: () => set((state) => ({ strokes: state.strokes.slice(0, -1) })),
  clear: () => set({ strokes: [] }),
}))
