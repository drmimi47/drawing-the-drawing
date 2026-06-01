import { create } from 'zustand'
import type { Graph, IntentPin, IntentType, LockPolygon, RawSample, SamplePoint } from '../types/geometry'
import { emptyGraph } from '../types/geometry'
import { addStrokeToGraph, eraseGraphCapsule } from '../geometry/graph'
import { segmentStrokesByPolygon } from '../geometry/clip'
import { simplifyRDP } from '../geometry/simplify'

/**
 * Central canvas + tool state (Cluster D).
 *
 * The editable geometry is a planar graph (the source of truth). Strokes are
 * committed through `commitStroke`, which inserts them into the graph and splits
 * crossings into shared vertices. Undo snapshots the whole graph.
 */

export type ToolMode =
  | 'DRAW'
  | 'ERASE'
  | 'PAN'
  | 'SELECT'
  | 'LASSO'
  | 'VECTOR'
  | 'LASSO_LOCK'
  | 'INTENT_PIN'
export type Stage = 'SKETCH' | 'NORMALIZE' | 'LOCK_INTENT' | 'GENERATE'

/** Tools that maintain (rather than clear) the current selection. */
const SELECTION_TOOLS = new Set<ToolMode>(['SELECT', 'LASSO'])

let lockCounter = 0
let pinCounter = 0

const HISTORY_LIMIT = 100

/** One undo/redo step: a snapshot of everything that an action can change. */
interface HistoryEntry {
  graph: Graph
  lockPolygons: LockPolygon[]
  intentPins: IntentPin[]
}

/** Transient state while placing an intent pin (center → type → radius → commit). */
export interface PendingPin {
  x: number
  y: number
  /** Screen position of the placement click, for positioning the type popup. */
  screenX: number
  screenY: number
  phase: 'type' | 'radius'
  intentType: IntentType | null
  radius: number
}

interface DrawingState {
  toolMode: ToolMode
  stage: Stage
  strokeColor: string
  /** Nominal stroke width in world units (1 world unit = 1px at zoom 1). */
  baseWidth: number
  graph: Graph
  /** IDs of strokes currently selected (for selection-scoped normalize). */
  selectedStrokeIds: string[]
  /** Geometric lock regions (feathered) that gate normalize/generate. */
  lockPolygons: LockPolygon[]
  /** Intent pins (spatial prompts that steer Phase-2 generation). */
  intentPins: IntentPin[]
  /** Transient pin being placed, or null. */
  pendingPin: PendingPin | null
  /** Undo/redo stacks: snapshots of graph + locks + pins before each action. */
  past: HistoryEntry[]
  future: HistoryEntry[]

  setTool: (tool: ToolMode) => void
  setStage: (stage: Stage) => void
  setColor: (color: string) => void
  setBaseWidth: (width: number) => void
  setSelection: (ids: string[]) => void
  clearSelection: () => void
  /** Segment strokes at the region boundary and select the enclosed pieces. */
  applyLassoSelection: (region: { x: number; y: number }[]) => void
  addLock: (lock: Omit<LockPolygon, 'id'>) => void
  /** Segment strokes at the lock boundary, then add the lock (one undo step). */
  addLockRegion: (points: { x: number; y: number }[], featherRadius: number) => void
  removeLock: (id: string) => void
  clearLocks: () => void
  removeIntentPin: (id: string) => void
  // Intent pin placement flow.
  beginPin: (x: number, y: number, screenX: number, screenY: number) => void
  setPinType: (intentType: IntentType) => void
  setPinRadius: (radius: number) => void
  commitPin: () => void
  cancelPin: () => void
  /** Move vertices (used to preview/commit normalize); does not record undo history. */
  setVertexPositions: (updates: Record<string, { x: number; y: number }>) => void

  /** Snapshot current state onto the undo stack (call once at the start of an action). */
  beginHistory: () => void
  /** Replace the graph without touching history (used mid-action, e.g. erasing). */
  setGraph: (graph: Graph) => void
  /** Commit a finished freehand stroke (records one undo step). */
  commitStroke: (points: SamplePoint[], color: string, raw?: RawSample[]) => void
  /** Erase along the swept capsule (caller manages history for the drag). */
  eraseCapsule: (ax: number, ay: number, bx: number, by: number, r: number) => boolean
  undo: () => void
  redo: () => void
  /** Pop the last snapshot WITHOUT creating a redo step (used to cancel a preview). */
  revertHistory: () => void
  clear: () => void
}

export const useDrawingStore = create<DrawingState>((set, get) => ({
  toolMode: 'DRAW',
  stage: 'SKETCH',
  strokeColor: '#1a1a1a',
  baseWidth: 3.5,
  graph: emptyGraph(),
  selectedStrokeIds: [],
  lockPolygons: [],
  intentPins: [],
  pendingPin: null,
  past: [],
  future: [],

  setTool: (tool) =>
    set((state) => ({
      toolMode: tool,
      // Leaving the selection tools clears the highlight so it doesn't linger.
      selectedStrokeIds: SELECTION_TOOLS.has(tool) ? state.selectedStrokeIds : [],
      // Abandon any in-progress pin placement when leaving the pin tool.
      pendingPin: tool === 'INTENT_PIN' ? state.pendingPin : null,
    })),
  setStage: (stage) => set({ stage }),
  setColor: (color) => set({ strokeColor: color }),
  setBaseWidth: (width) => set({ baseWidth: width }),
  setSelection: (ids) => set({ selectedStrokeIds: ids }),
  clearSelection: () => set({ selectedStrokeIds: [] }),
  applyLassoSelection: (region) => {
    const poly = simplifyRDP(region, 2)
    if (poly.length < 3) {
      set({ selectedStrokeIds: [] })
      return
    }
    set((state) => {
      const { graph, insideStrokeIds, changed } = segmentStrokesByPolygon(state.graph, poly)
      if (!changed) return { selectedStrokeIds: insideStrokeIds }
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        graph,
        selectedStrokeIds: insideStrokeIds,
      }
    })
  },
  addLock: (lock) =>
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: [],
      lockPolygons: [...state.lockPolygons, { ...lock, id: `lock-${Date.now()}-${lockCounter++}` }],
    })),
  addLockRegion: (points, featherRadius) => {
    const poly = simplifyRDP(points, 2)
    if (poly.length < 3) return
    set((state) => {
      const seg = segmentStrokesByPolygon(state.graph, poly)
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        graph: seg.changed ? seg.graph : state.graph,
        lockPolygons: [
          ...state.lockPolygons,
          { points: poly, featherRadius, id: `lock-${Date.now()}-${lockCounter++}` },
        ],
      }
    })
  },
  removeLock: (id) =>
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: [],
      lockPolygons: state.lockPolygons.filter((l) => l.id !== id),
    })),
  clearLocks: () =>
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: [],
      lockPolygons: [],
    })),
  removeIntentPin: (id) =>
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: [],
      intentPins: state.intentPins.filter((p) => p.id !== id),
    })),

  beginPin: (x, y, screenX, screenY) =>
    set({ pendingPin: { x, y, screenX, screenY, phase: 'type', intentType: null, radius: 40 } }),
  setPinType: (intentType) =>
    set((state) =>
      state.pendingPin ? { pendingPin: { ...state.pendingPin, intentType, phase: 'radius' } } : {},
    ),
  setPinRadius: (radius) =>
    set((state) => (state.pendingPin ? { pendingPin: { ...state.pendingPin, radius } } : {})),
  commitPin: () =>
    set((state) => {
      const p = state.pendingPin
      if (!p || !p.intentType) return { pendingPin: null }
      const pin: IntentPin = {
        id: `pin-${Date.now()}-${pinCounter++}`,
        x: p.x,
        y: p.y,
        radius: Math.max(8, p.radius),
        intentType: p.intentType,
      }
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        intentPins: [...state.intentPins, pin],
        pendingPin: null,
      }
    }),
  cancelPin: () => set({ pendingPin: null }),
  setVertexPositions: (updates) =>
    set((state) => {
      const vertices = { ...state.graph.vertices }
      for (const id in updates) {
        const v = vertices[id]
        if (v) vertices[id] = { ...v, x: updates[id].x, y: updates[id].y }
      }
      return { graph: { vertices, strokes: state.graph.strokes } }
    }),

  beginHistory: () =>
    set((state) => ({ past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT), future: [] })),
  setGraph: (graph) => set({ graph }),
  commitStroke: (points, color, raw) =>
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: [],
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
      return {
        graph: previous.graph,
        lockPolygons: previous.lockPolygons,
        intentPins: previous.intentPins,
        past,
        future: [...state.future, snapshot(state)].slice(-HISTORY_LIMIT),
      }
    }),
  redo: () =>
    set((state) => {
      if (state.future.length === 0) return {}
      const future = state.future.slice()
      const next = future.pop()!
      return {
        graph: next.graph,
        lockPolygons: next.lockPolygons,
        intentPins: next.intentPins,
        future,
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      }
    }),
  revertHistory: () =>
    set((state) => {
      if (state.past.length === 0) return {}
      const past = state.past.slice()
      const previous = past.pop()!
      return {
        graph: previous.graph,
        lockPolygons: previous.lockPolygons,
        intentPins: previous.intentPins,
        past,
      }
    }),
  clear: () =>
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: [],
      graph: emptyGraph(),
    })),
}))

function snapshot(state: {
  graph: Graph
  lockPolygons: LockPolygon[]
  intentPins: IntentPin[]
}): HistoryEntry {
  return { graph: state.graph, lockPolygons: state.lockPolygons, intentPins: state.intentPins }
}
