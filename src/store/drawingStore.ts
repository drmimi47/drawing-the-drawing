import { create } from 'zustand'
import type {
  Boundary,
  CirculationPath,
  Graph,
  IntentPin,
  IntentType,
  LineStyle,
  LockPolygon,
  RawSample,
  SamplePoint,
  SnapGuide,
  TextLabel,
} from '../types/geometry'
import { emptyGraph } from '../types/geometry'
import { addStrokeToGraph, eraseGraphCapsule } from '../geometry/graph'
import { segmentStrokesByPolygon } from '../geometry/clip'
import { simplifyRDP } from '../geometry/simplify'
import { buildSnapIndex, type SpatialGrid } from '../geometry/spatialIndex'
import { buildCirculationMask } from '../geometry/corridor'

/**
 * Central canvas + tool state (Cluster D).
 *
 * The editable geometry is a planar graph (the source of truth). Strokes are
 * committed through `commitStroke`, which inserts them into the graph and splits
 * crossings into shared vertices. Undo snapshots the whole graph.
 */

export type ToolMode =
  | 'DRAW'
  | 'POLYLINE'
  | 'ERASE'
  | 'PAN'
  | 'SELECT'
  | 'LASSO'
  | 'VECTOR'
  | 'LASSO_LOCK'
  | 'INTENT_PIN'
  | 'TEXT'
export type Stage = 'SKETCH' | 'NORMALIZE' | 'LOCK_INTENT' | 'GENERATE'
export type ToolbarPosition = 'top' | 'right' | 'bottom' | 'left'

/**
 * Bloom restructure (restructure_v1.txt) — the guided constraint-accumulating
 * pipeline. The active layer is surfaced by the right-panel Layer Navigator
 * (Foundation A) and gates the workflow top-down while staying revisitable.
 * Introduced alongside (not replacing) the legacy `stage` so existing UI keeps
 * working during the transition.
 */
export type PipelineLayer =
  | 'CONTEXT'
  | 'BOUNDARY'
  | 'CIRCULATION'
  | 'DEPARTMENTS'
  | 'ROOMS'
  | 'GENERATE'

/** Drawing substrate chosen in Stage 0 (Context): real map vs blank artboard. */
export type CanvasContext = 'MAP' | 'BLANK'

/** Background grid lattice for the blank-sheet substrate ('none' = no grid). */
export type GridType = 'none' | 'square' | 'triangle' | 'dots'

/** Pipeline layer order (index drives the sequential unlock in the Layer panel). */
export const LAYER_ORDER: PipelineLayer[] = [
  'CONTEXT',
  'BOUNDARY',
  'CIRCULATION',
  'DEPARTMENTS',
  'ROOMS',
  'GENERATE',
]

/** Default artboard size in world units (3:2 landscape, ARCH-D-like). */
export const DEFAULT_PAGE_WIDTH = 1080
export const DEFAULT_PAGE_HEIGHT = 720

/** Fraction of the page frame an imported asset is fit within (keeps a margin). */
const UNDERLAY_FIT_MARGIN = 0.92

/**
 * A dimmed, read-only background image to trace over (PDF/image import).
 *
 * The underlay carries its OWN placement transform (a centered rect on the world
 * grid) so importing an asset never resizes the global page frame — multiple
 * assets can be swapped in/out against one stable coordinate system.
 */
export interface Underlay {
  /** Data URL of the raster (a PDF page is pre-rendered to an image). */
  src: string
  /** 0..1 dim factor for the underlay plane. */
  opacity: number
  /** Intrinsic raster pixel dimensions of the imported asset. */
  pixelWidth: number
  pixelHeight: number
  /** Placement on the world grid: center offset (world units). */
  x: number
  y: number
  /** Mesh size on the world grid (world units), aspect-preserving. */
  width: number
  height: number
}

/** Fit an asset's intrinsic pixels into the page frame, centered, aspect-preserving. */
function fitUnderlayToPage(
  pixelWidth: number,
  pixelHeight: number,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(
    (pageWidth * UNDERLAY_FIT_MARGIN) / pixelWidth,
    (pageHeight * UNDERLAY_FIT_MARGIN) / pixelHeight,
  )
  return { x: 0, y: 0, width: pixelWidth * scale, height: pixelHeight * scale }
}

/** Tools that maintain (rather than clear) the current selection. */
const SELECTION_TOOLS = new Set<ToolMode>(['SELECT', 'LASSO'])

let lockCounter = 0
let pinCounter = 0
let textCounter = 0
let circulationCounter = 0

const HISTORY_LIMIT = 100

/** One undo/redo step: a snapshot of everything that an action can change. */
interface HistoryEntry {
  graph: Graph
  lockPolygons: LockPolygon[]
  intentPins: IntentPin[]
  textLabels: TextLabel[]
}

/** Transient text being placed/edited, or null. */
export interface PendingText {
  x: number
  y: number
  screenX: number
  screenY: number
  /** Existing label id when editing, else null for a new one. */
  id: string | null
  initial: string
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
  /** Active pen weight — nominal stroke width in world units (1 unit = 1px @ zoom 1). */
  baseWidth: number
  /** Active pen line style applied to newly drawn strokes (drafting hierarchy). */
  lineStyle: LineStyle
  graph: Graph
  /** Spatial index of snap targets (vertices + edge midpoints), auto-rebuilt
   *  whenever the graph changes. Queried by the snapping engine. */
  spatialIndex: SpatialGrid
  /** IDs of strokes currently selected (for selection-scoped normalize). */
  selectedStrokeIds: string[]
  /** Geometric lock regions (feathered) that gate normalize/generate. */
  lockPolygons: LockPolygon[]
  /** Intent pins (spatial prompts that steer Phase-2 generation). */
  intentPins: IntentPin[]
  /** Transient pin being placed, or null. */
  pendingPin: PendingPin | null
  /** Free-floating text annotations. */
  textLabels: TextLabel[]
  /** Transient text being placed/edited, or null. */
  pendingText: PendingText | null
  /** When true, every pin shows its intent-type label (driven by toolbar hover). */
  showIntentLabels: boolean
  /** When true, overlay a grid of region intent-concentration percentages
   *  (driven by toolbar hover over the Intent Pin button). */
  showIntentGrid: boolean
  /** Which edge the main tool dock is docked to. */
  toolbarPosition: ToolbarPosition
  /** Artboard (page sheet) size in world units. Independent world coordinate
   *  frame — NOT driven by imports; only the user/default sets it. */
  pageWidth: number
  pageHeight: number
  /** Dimmed read-only tracing underlay (carries its own transform), or null. */
  underlay: Underlay | null
  /** Live real-world scale: meters per world unit (1 world unit = 1px @ zoom 1).
   *  Null until calibrated (currently derived from the active Mapbox projection). */
  metersPerWorldUnit: number | null
  /** Whether the Mapbox map overlay is shown (as a dim underlay beneath drawing). */
  mapActive: boolean
  /** Map underlay dim amount 0..1 (0 = full map, 1 = faded to white). */
  mapDim: number
  /** Finalized GeoJSON drawn on the map, for the main app to reference/store. */
  mapGeometry: GeoJSON.FeatureCollection | null
  /** Active CAD snap guide emitted by the polyline snapping pipeline (Step 1). */
  activeSnapGuide: SnapGuide | null
  /** Active pipeline layer (Bloom restructure — right-panel Layer Navigator). */
  activeLayer: PipelineLayer
  /** Highest layer index the user has reached; gates the sequential unlock (they
   *  can revisit any reached layer and step forward one at a time). */
  maxLayerReached: number
  /** Drawing substrate chosen in the Context layer; null until the user picks. */
  context: CanvasContext | null
  /** Blank-sheet background grid lattice + spacing (world units). */
  gridType: GridType
  gridSpacing: number
  /** Lot boundary (Stage 1) — the master working area; null until traced. */
  boundary: Boundary | null
  /** Circulation centerlines (Stage 2). */
  circulationPaths: CirculationPath[]
  /** Global corridor width (world units) applied to new/unlocked paths. */
  circulationWidth: number
  /** Derived keep-out mask: one band ring per path (point-in-any-band). Null when
   *  there are no corridors. Recomputed whenever the circulation set changes. */
  circulationMask: { x: number; y: number }[][] | null
  /** Master object-snapping switch (Cluster 4). When false, the Polyline and
   *  Vector-Edit snap pipelines short-circuit to raw pointer input. Default on. */
  snappingEnabled: boolean
  /** Object-snap tracking (O-TRACK) anchors acquired by the Polyline tool by
   *  hovering a vertex/midpoint. Capped at 2; alignment rays project from these.
   *  Transient — cleared on path completion, cancel, or leaving the polyline tool. */
  trackedPoints: Array<{ id: string; coords: [number, number] }>;
  /** Undo/redo stacks: snapshots of graph + locks + pins before each action. */
  past: HistoryEntry[]
  future: HistoryEntry[]

  /** Write the active snap guide (or clear it by passing null). Called each pointer-move frame by the polyline snapping pipeline. */
  setSnapGuide: (guide: SnapGuide | null) => void
  /** Flip the master snapping switch. Clears any live guide when turning off so
   *  on-canvas cues vanish instantly. */
  toggleSnapping: () => void
  /** Acquire an O-TRACK anchor (no-op if already tracked); caps at 2, dropping
   *  the oldest. */
  addTrackedPoint: (id: string, coords: [number, number]) => void
  /** Drop all O-TRACK anchors. */
  clearTrackedPoints: () => void
  setTool: (tool: ToolMode) => void
  setStage: (stage: Stage) => void
  /** Switch the active pipeline layer (right-panel navigator). */
  setActiveLayer: (layer: PipelineLayer) => void
  /** Choose the Context substrate; MAP turns the Mapbox overlay on, BLANK off. */
  setContext: (ctx: CanvasContext) => void
  /** Blank-sheet grid lattice + spacing controls. */
  setGridType: (type: GridType) => void
  setGridSpacing: (spacing: number) => void
  /** Commit/replace the lot boundary from a traced ring (no-op if locked). */
  setBoundary: (ring: { x: number; y: number }[]) => void
  /** Remove the lot boundary (no-op if locked). */
  clearBoundary: () => void
  /** Set the advisory target area (drives the delta readout); undefined clears it. */
  setBoundaryTargetSqf: (sqf: number | undefined) => void
  /** Freeze/unfreeze the boundary as an immutable anchor (Foundation A). */
  setBoundaryLocked: (locked: boolean) => void
  /** Add a circulation centerline (uses the current global width); rebuilds mask. */
  addCirculationPath: (centerline: { x: number; y: number }[]) => void
  /** Remove all UNLOCKED circulation paths; rebuilds mask. */
  clearCirculation: () => void
  /** Set the global corridor width; re-offsets unlocked paths + rebuilds mask. */
  setCirculationWidth: (width: number) => void
  /** Lock/unlock all circulation paths (Foundation A group lock). */
  setCirculationLocked: (locked: boolean) => void
  setColor: (color: string) => void
  setBaseWidth: (width: number) => void
  setLineStyle: (style: LineStyle) => void
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
  // Text placement flow.
  beginText: (x: number, y: number, screenX: number, screenY: number, id: string | null, initial: string) => void
  commitText: (value: string) => void
  cancelText: () => void
  /** Move a text label (used by the Edit tool drag); no undo history per move. */
  moveText: (id: string, x: number, y: number) => void
  setShowIntentLabels: (show: boolean) => void
  setShowIntentGrid: (show: boolean) => void
  setToolbarPosition: (position: ToolbarPosition) => void
  /** Resize the independent world frame (page sheet) in world units. */
  setPageSize: (width: number, height: number) => void
  /** Place a tracing underlay, fitting the asset's pixels into the page frame.
   *  Does NOT resize the page — the world coordinate frame stays fixed. */
  setUnderlay: (src: string, pixelWidth: number, pixelHeight: number) => void
  setUnderlayOpacity: (opacity: number) => void
  /** Remove the underlay (the page frame is unaffected). */
  clearUnderlay: () => void
  /** Set the live real-world scale (meters per world unit), or null to clear. */
  setGeoScale: (metersPerWorldUnit: number | null) => void
  setMapActive: (active: boolean) => void
  toggleMap: () => void
  /** Set the map underlay dim amount (0..1). */
  setMapDim: (dim: number) => void
  setMapGeometry: (geometry: GeoJSON.FeatureCollection | null) => void
  /** Move vertices (used to preview/commit normalize); does not record undo history. */
  setVertexPositions: (updates: Record<string, { x: number; y: number }>) => void

  /** Snapshot current state onto the undo stack (call once at the start of an action). */
  beginHistory: () => void
  /** Replace the graph without touching history (used mid-action, e.g. erasing). */
  setGraph: (graph: Graph) => void
  /** Commit a finished stroke (records one undo step). `straight` = polyline. */
  commitStroke: (points: SamplePoint[], color: string, raw?: RawSample[], straight?: boolean) => void
  /** Erase along the swept capsule (caller manages history for the drag). */
  eraseCapsule: (ax: number, ay: number, bx: number, by: number, r: number) => boolean
  undo: () => void
  redo: () => void
  /** Pop the last snapshot WITHOUT creating a redo step (used to cancel a preview). */
  revertHistory: () => void
  clear: () => void
}

export const useDrawingStore = create<DrawingState>((set, get) => ({
  // Starts in the Context layer (map setup), where creation tools are disabled, so
  // the initial tool is Pan rather than Draw.
  toolMode: 'PAN',
  stage: 'SKETCH',
  strokeColor: '#1a1a1a',
  baseWidth: 2,
  lineStyle: 'solid',
  graph: emptyGraph(),
  spatialIndex: buildSnapIndex(emptyGraph()),
  selectedStrokeIds: [],
  lockPolygons: [],
  intentPins: [],
  pendingPin: null,
  textLabels: [],
  pendingText: null,
  showIntentLabels: false,
  showIntentGrid: false,
  toolbarPosition: 'bottom',
  pageWidth: DEFAULT_PAGE_WIDTH,
  pageHeight: DEFAULT_PAGE_HEIGHT,
  underlay: null,
  metersPerWorldUnit: null,
  mapActive: false,
  mapDim: 0.35,
  mapGeometry: null,
  activeSnapGuide: null,
  activeLayer: 'CONTEXT',
  maxLayerReached: 0,
  context: null,
  gridType: 'none',
  gridSpacing: 32,
  boundary: null,
  circulationPaths: [],
  circulationWidth: 12,
  circulationMask: null,
  snappingEnabled: true,
  trackedPoints: [],
  past: [],
  future: [],

  setSnapGuide: (guide) => set({ activeSnapGuide: guide }),
  toggleSnapping: () =>
    set((state) => ({
      snappingEnabled: !state.snappingEnabled,
      // Turning snapping OFF should wipe any guide still on screen.
      activeSnapGuide: state.snappingEnabled ? null : state.activeSnapGuide,
    })),
  addTrackedPoint: (id, coords) =>
    set((state) => {
      if (state.trackedPoints.some((p) => p.id === id)) return {}
      return { trackedPoints: [...state.trackedPoints, { id, coords }].slice(-2) }
    }),
  clearTrackedPoints: () =>
    set((state) => (state.trackedPoints.length ? { trackedPoints: [] } : {})),
  setTool: (tool) =>
    set((state) => ({
      toolMode: tool,
      // Leaving the selection tools clears the highlight so it doesn't linger.
      selectedStrokeIds: SELECTION_TOOLS.has(tool) ? state.selectedStrokeIds : [],
      // Abandon any in-progress pin/text placement when leaving those tools.
      pendingPin: tool === 'INTENT_PIN' ? state.pendingPin : null,
      pendingText: tool === 'TEXT' ? state.pendingText : null,
      // Clear any active snap guide + O-TRACK anchors when leaving the polyline tool.
      activeSnapGuide: tool === 'POLYLINE' ? state.activeSnapGuide : null,
      trackedPoints: tool === 'POLYLINE' ? state.trackedPoints : [],
    })),
  setStage: (stage) => set({ stage }),
  setActiveLayer: (layer) =>
    set((state) => ({
      activeLayer: layer,
      maxLayerReached: Math.max(state.maxLayerReached, LAYER_ORDER.indexOf(layer)),
    })),
  setContext: (ctx) => set({ context: ctx, mapActive: ctx === 'MAP' }),
  setGridType: (type) => set({ gridType: type }),
  setGridSpacing: (spacing) => set({ gridSpacing: Math.max(1, Math.round(spacing) || 1) }),
  setBoundary: (ring) =>
    set((state) => {
      if (state.boundary?.isLocked) return {} // locked boundary is immutable
      // Normalize: drop a trailing point that repeats the first (closed ring).
      const r = ring.slice()
      if (r.length > 1) {
        const a = r[0]
        const b = r[r.length - 1]
        if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) r.pop()
      }
      if (r.length < 3) return {}
      return { boundary: { ...state.boundary, ring: r } }
    }),
  clearBoundary: () =>
    set((state) => (state.boundary?.isLocked ? {} : { boundary: null })),
  setBoundaryTargetSqf: (sqf) =>
    set((state) => (state.boundary ? { boundary: { ...state.boundary, targetSqf: sqf } } : {})),
  setBoundaryLocked: (locked) =>
    set((state) => (state.boundary ? { boundary: { ...state.boundary, isLocked: locked } } : {})),
  addCirculationPath: (centerline) =>
    set((state) => {
      if (centerline.length < 2) return {}
      const path: CirculationPath = {
        id: `circ-${Date.now()}-${circulationCounter++}`,
        centerline: centerline.map((p) => ({ x: p.x, y: p.y })),
        width: state.circulationWidth,
      }
      const circulationPaths = [...state.circulationPaths, path]
      return { circulationPaths, circulationMask: buildCirculationMask(circulationPaths) }
    }),
  clearCirculation: () =>
    set((state) => {
      const remaining = state.circulationPaths.filter((p) => p.isLocked)
      return {
        circulationPaths: remaining,
        circulationMask: remaining.length ? buildCirculationMask(remaining) : null,
      }
    }),
  setCirculationWidth: (width) =>
    set((state) => {
      const w = Math.max(1, width)
      const circulationPaths = state.circulationPaths.map((p) => (p.isLocked ? p : { ...p, width: w }))
      return {
        circulationWidth: w,
        circulationPaths,
        circulationMask: circulationPaths.length ? buildCirculationMask(circulationPaths) : null,
      }
    }),
  setCirculationLocked: (locked) =>
    set((state) => ({ circulationPaths: state.circulationPaths.map((p) => ({ ...p, isLocked: locked })) })),
  setColor: (color) => set({ strokeColor: color }),
  setBaseWidth: (width) => set({ baseWidth: width }),
  setLineStyle: (style) => set({ lineStyle: style }),
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

  beginText: (x, y, screenX, screenY, id, initial) =>
    set({ pendingText: { x, y, screenX, screenY, id, initial } }),
  commitText: (value) =>
    set((state) => {
      const p = state.pendingText
      if (!p) return {}
      const text = value.trim()
      // Editing an existing label.
      if (p.id) {
        const labels = text
          ? state.textLabels.map((l) => (l.id === p.id ? { ...l, text } : l))
          : state.textLabels.filter((l) => l.id !== p.id)
        return {
          past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
          future: [],
          textLabels: labels,
          pendingText: null,
        }
      }
      // New label (ignore empty).
      if (!text) return { pendingText: null }
      const label: TextLabel = {
        id: `text-${Date.now()}-${textCounter++}`,
        x: p.x,
        y: p.y,
        text,
        color: state.strokeColor,
        size: 16,
      }
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        textLabels: [...state.textLabels, label],
        pendingText: null,
      }
    }),
  cancelText: () => set({ pendingText: null }),
  moveText: (id, x, y) =>
    set((state) => ({ textLabels: state.textLabels.map((l) => (l.id === id ? { ...l, x, y } : l)) })),
  setShowIntentLabels: (show) => set({ showIntentLabels: show }),
  setShowIntentGrid: (show) => set({ showIntentGrid: show }),
  setToolbarPosition: (position) => set({ toolbarPosition: position }),
  setPageSize: (width, height) =>
    set((state) => {
      const pageWidth = Math.max(1, width)
      const pageHeight = Math.max(1, height)
      // Re-fit any existing underlay into the resized frame.
      const underlay = state.underlay
        ? { ...state.underlay, ...fitUnderlayToPage(state.underlay.pixelWidth, state.underlay.pixelHeight, pageWidth, pageHeight) }
        : null
      return { pageWidth, pageHeight, underlay }
    }),
  setUnderlay: (src, pixelWidth, pixelHeight) =>
    set((state) => ({
      underlay: {
        src,
        opacity: 0.5,
        pixelWidth,
        pixelHeight,
        ...fitUnderlayToPage(pixelWidth, pixelHeight, state.pageWidth, state.pageHeight),
      },
    })),
  setUnderlayOpacity: (opacity) =>
    set((state) => (state.underlay ? { underlay: { ...state.underlay, opacity } } : {})),
  clearUnderlay: () => set({ underlay: null }),
  setGeoScale: (metersPerWorldUnit) => set({ metersPerWorldUnit }),
  setMapActive: (active) => set({ mapActive: active }),
  toggleMap: () => set((state) => ({ mapActive: !state.mapActive })),
  setMapDim: (dim) => set({ mapDim: Math.max(0, Math.min(1, dim)) }),
  setMapGeometry: (geometry) => set({ mapGeometry: geometry }),
  setVertexPositions: (updates) =>
    set((state) => {
      const vertices = { ...state.graph.vertices }
      // Incrementally re-bucket only the moved vertices (and their incident edge
      // midpoints) in place — this is the per-frame drag hot path, so it must not
      // trigger a full index rebuild. Preserving the strokes reference signals to
      // the index-maintenance subscription that topology is unchanged.
      const grid = state.spatialIndex
      for (const id in updates) {
        const v = vertices[id]
        if (v) {
          vertices[id] = { ...v, x: updates[id].x, y: updates[id].y }
          grid.moveVertex(id, updates[id].x, updates[id].y)
        }
      }
      return { graph: { vertices, strokes: state.graph.strokes } }
    }),

  beginHistory: () =>
    set((state) => ({ past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT), future: [] })),
  setGraph: (graph) => set({ graph }),
  commitStroke: (points, color, raw, straight) =>
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: [],
      graph: addStrokeToGraph(state.graph, points, color, raw, straight, {
        strokeWidth: state.baseWidth,
        lineStyle: state.lineStyle,
      }),
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
        textLabels: previous.textLabels,
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
        textLabels: next.textLabels,
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
        textLabels: previous.textLabels,
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
  textLabels: TextLabel[]
}): HistoryEntry {
  return {
    graph: state.graph,
    lockPolygons: state.lockPolygons,
    intentPins: state.intentPins,
    textLabels: state.textLabels,
  }
}

// Keep the spatial snap index in lockstep with the graph (improvements C2).
//
// Position-only vertex moves (the drag hot path) are handled INCREMENTALLY inside
// setVertexPositions, which re-buckets just the moved vertices in place and leaves
// the strokes array reference untouched. Any action that changes topology — stroke
// commit, polyline finish, erase, lock/lasso segmentation, undo/redo, clear —
// produces a NEW strokes array, so strokes-reference inequality is an O(1) signal
// that the edge set changed and the index must be rebuilt from scratch. This keeps
// one central maintenance seam without the O(N) rebuild firing on every drag frame.
useDrawingStore.subscribe((state, prev) => {
  if (state.graph === prev.graph) return
  if (state.graph.strokes === prev.graph.strokes) return // position-only move, already indexed incrementally
  useDrawingStore.setState({ spatialIndex: buildSnapIndex(state.graph) })
})
