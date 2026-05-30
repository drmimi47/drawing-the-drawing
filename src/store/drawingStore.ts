import { create } from 'zustand'
import type { Graph, RawSample, SamplePoint } from '../types/geometry'
import { emptyGraph } from '../types/geometry'
import { addStrokeToGraph, eraseGraphCapsule } from '../geometry/graph'

/**
 * Central canvas + tool state (Cluster D).
 *
 * The editable geometry is a planar graph (the source of truth). Strokes are
 * committed through `commitStroke`, which inserts them into the graph and splits
 * crossings into shared vertices. Undo snapshots the whole graph.
 */

export type ToolMode = 'DRAW' | 'ERASE' | 'PAN' | 'LOCK'
export type MutationMode = 'NORMALIZATION' | 'RATIONALISM' | 'HALLUCINATION'

const HISTORY_LIMIT = 100

interface DrawingState {
  toolMode: ToolMode
  mutationMode: MutationMode
  strokeColor: string
  /** Nominal stroke width in world units (1 world unit = 1px at zoom 1). */
  baseWidth: number
  graph: Graph
  /** Undo history: graph snapshots taken before each action. */
  past: Graph[]

  setTool: (tool: ToolMode) => void
  setMutationMode: (mode: MutationMode) => void
  setColor: (color: string) => void
  setBaseWidth: (width: number) => void
  /** Move vertices (used to animate mutations); does not record undo history. */
  setVertexPositions: (updates: Record<string, { x: number; y: number }>) => void

  /** Push the current graph onto the undo stack (call once at the start of an action). */
  beginHistory: () => void
  /** Replace the graph without touching history (used mid-action, e.g. erasing). */
  setGraph: (graph: Graph) => void
  /** Commit a finished freehand stroke (records one undo step). */
  commitStroke: (points: SamplePoint[], color: string, raw?: RawSample[]) => void
  /** Erase along the swept capsule (caller manages history for the drag). */
  eraseCapsule: (ax: number, ay: number, bx: number, by: number, r: number) => boolean
  undo: () => void
  clear: () => void
}

export const useDrawingStore = create<DrawingState>((set, get) => ({
  toolMode: 'DRAW',
  mutationMode: 'NORMALIZATION',
  strokeColor: '#1a1a1a',
  baseWidth: 3.5,
  graph: emptyGraph(),
  past: [],

  setTool: (tool) => set({ toolMode: tool }),
  setMutationMode: (mode) => set({ mutationMode: mode }),
  setColor: (color) => set({ strokeColor: color }),
  setBaseWidth: (width) => set({ baseWidth: width }),
  setVertexPositions: (updates) =>
    set((state) => {
      const vertices = { ...state.graph.vertices }
      for (const id in updates) {
        const v = vertices[id]
        if (v) vertices[id] = { ...v, x: updates[id].x, y: updates[id].y }
      }
      return { graph: { vertices, strokes: state.graph.strokes } }
    }),

  beginHistory: () => set((state) => ({ past: [...state.past, state.graph].slice(-HISTORY_LIMIT) })),
  setGraph: (graph) => set({ graph }),
  commitStroke: (points, color, raw) =>
    set((state) => ({
      past: [...state.past, state.graph].slice(-HISTORY_LIMIT),
      graph: addStrokeToGraph(state.graph, points, color, raw),
    })),
  eraseCapsule: (ax, ay, bx, by, r) => {
    const { graph } = get()
    const next = eraseGraphCapsule(graph, ax, ay, bx, by, r)
    if (next === graph) return false
    set({ graph: next })
    return true
  },
  undo: () =>
    set((state) => {
      if (state.past.length === 0) return {}
      const past = state.past.slice()
      const previous = past.pop()!
      return { graph: previous, past }
    }),
  clear: () => set((state) => ({ past: [...state.past, state.graph].slice(-HISTORY_LIMIT), graph: emptyGraph() })),
}))
