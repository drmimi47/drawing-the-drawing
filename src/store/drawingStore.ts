import { create } from 'zustand'

/**
 * Central canvas + tool state (Clusters B–C).
 *
 * Stroke/tool types live here for now; Cluster D promotes the geometry types to
 * `types/geometry.ts` when the planar graph lands.
 */

export type ToolMode = 'DRAW' | 'ERASE' | 'PAN' | 'LOCK'

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

const HISTORY_LIMIT = 100

interface DrawingState {
  toolMode: ToolMode
  strokeColor: string
  /** Nominal stroke width in world units (1 world unit = 1px at zoom 1). */
  baseWidth: number
  strokes: Stroke[]
  /** Undo history: snapshots of the strokes array before each action. */
  past: Stroke[][]

  setTool: (tool: ToolMode) => void
  setColor: (color: string) => void
  setBaseWidth: (width: number) => void

  /** Push the current strokes onto the undo stack (call at the start of an action). */
  beginHistory: () => void
  /** Replace strokes without touching history (used mid-action, e.g. erasing). */
  setStrokes: (strokes: Stroke[]) => void
  /** Commit a finished stroke (records one undo step). */
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
  past: [],

  setTool: (tool) => set({ toolMode: tool }),
  setColor: (color) => set({ strokeColor: color }),
  setBaseWidth: (width) => set({ baseWidth: width }),

  beginHistory: () =>
    set((state) => ({ past: [...state.past, state.strokes].slice(-HISTORY_LIMIT) })),
  setStrokes: (strokes) => set({ strokes }),
  addStroke: (stroke) =>
    set((state) => ({
      past: [...state.past, state.strokes].slice(-HISTORY_LIMIT),
      strokes: [...state.strokes, stroke],
    })),
  undo: () =>
    set((state) => {
      if (state.past.length === 0) return {}
      const past = state.past.slice()
      const previous = past.pop()!
      return { strokes: previous, past }
    }),
  clear: () => set((state) => ({ past: [...state.past, state.strokes].slice(-HISTORY_LIMIT), strokes: [] })),
}))
