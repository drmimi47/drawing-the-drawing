import { create } from 'zustand'
import type {
  Boundary,
  CirculationPath,
  CirculationTier,
  Department,
  DepartmentType,
  Graph,
  IntentPin,
  IntentType,
  LineStyle,
  LockPolygon,
  RawSample,
  Room,
  SamplePoint,
  ScribbleStroke,
  SnapGuide,
  TextLabel,
} from '../types/geometry'
import { emptyGraph, DEPARTMENT_META, FIXED_COLOR_DEPT_TYPES } from '../types/geometry'
import { generateRooms } from '../geometry/rooms'
import { findEdgeSplits, applyEdgeSplits, buildDragRig, type DragRig, type VertexUpdate } from '../geometry/roomEdit'
import { mergeRoomsAtWall, mergeRoomWithNeighbor } from '../geometry/roomMerge'
import { splitRoom as splitRoomGeom } from '../geometry/roomSplit'
import {
  addStrokeToGraph,
  eraseGraphCapsule,
  nearestStraightSegment,
  removeStrokeSegment,
  pointSegmentDistSq,
} from '../geometry/graph'
import { segmentStrokesByPolygon } from '../geometry/clip'
import { simplifyRDP } from '../geometry/simplify'
import { buildSnapIndex, type SpatialGrid, type ExtraPolyline } from '../geometry/spatialIndex'
import { buildCirculationMask } from '../geometry/corridor'
import { clipPolylineToPolygon } from '../geometry/clipPolyline'
import { nearestBoundarySegment, eraseBoundarySegment } from '../geometry/boundaryEdit'
import { scaleRingToArea, sqftToWorldArea, polygonAreaWorld, worldAreaToSqft } from '../geometry/area'
import { getIntentConcentration } from '../utils/metaballField'
import { pointInPolygon } from '../geometry/locks'

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
  | 'DEPT'
  | 'TEXT'

/**
 * Gradia restructure (restructure_v1.txt) — the guided constraint-accumulating
 * pipeline. The active layer is surfaced by the right-panel Layer Navigator
 * (Foundation A) and gates the workflow top-down while staying revisitable.
 */
export type PipelineLayer =
  | 'CONTEXT'
  | 'BOUNDARY'
  | 'CIRCULATION'
  | 'DEPARTMENTS'
  | 'ROOMS'
  | 'INTENT'

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
  'INTENT',
]

/** Default artboard size in world units (3:2 landscape, ARCH-D-like). */
export const DEFAULT_PAGE_WIDTH = 1080
export const DEFAULT_PAGE_HEIGHT = 720

/** World-unit gutter left between adjacent design-option canvases so they never touch. */
export const CANVAS_GAP = 160

export type CardinalDirection = 'N' | 'E' | 'S' | 'W'

/** How a newly spawned board is seeded: a blank slate, or a full copy (branch) of
 *  the currently selected board's state (geometry translated to the new location). */
export type CanvasInitMode = 'blank' | 'copy'

/**
 * A parallel design-option canvas ("branch"). Each canvas is a self-contained
 * document living at a world-space `origin` offset; all of its geometry is stored
 * in ABSOLUTE world coordinates near that origin. The CENTRAL canvas sits at
 * origin (0,0), so the single-canvas behavior is unchanged.
 *
 * The ACTIVE canvas's document is the live top-level store fields (so every tool
 * keeps editing it directly); inactive canvases are kept as snapshots in
 * `inactiveCanvasDocs` and rendered read-only at their offsets.
 */
export interface CanvasEntry {
  id: string
  origin: { x: number; y: number }
}

/**
 * A snapshotted per-canvas document (everything that is canvas-local, not
 * app-global). Each board carries its OWN layer pipeline memory — the active layer,
 * how far the sequential unlock has progressed, the chosen substrate (context), the
 * grid/scale settings, and all the per-layer geometry — so switching boards swaps in
 * a wholly independent workflow state and a brand-new board starts at "choose a
 * substrate" exactly as a freshly loaded page does.
 */
export interface CanvasDoc {
  graph: Graph
  lockPolygons: LockPolygon[]
  intentPins: IntentPin[]
  departments: Department[]
  rooms: Room[]
  lotGridSeams: { x: number; y: number }[][]
  textLabels: TextLabel[]
  scribbles: ScribbleStroke[]
  boundary: Boundary | null
  circulationPaths: CirculationPath[]
  underlay: Underlay | null
  pageWidth: number
  pageHeight: number
  sheetName: string
  // ── Per-board layer pipeline memory ──
  activeLayer: PipelineLayer
  maxLayerReached: number
  context: CanvasContext | null
  gridType: GridType
  gridSpacing: number
  boundaryInfillOpacity: number
  circulationWidth: number
  circulationMinorWidth: number
  metersPerWorldUnit: number | null
  mapActive: boolean
  mapDim: number
  mapGeometry: GeoJSON.FeatureCollection | null
}

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
let deptCounter = 0
let textCounter = 0
let circulationCounter = 0
let scribbleCounter = 0
let canvasCounter = 0
let roomActionSeq = 0

/** Wyvill footprint constant: an isolated department field clears the area-threshold out to
 *  ~0.732·radius, so its footprint area ≈ FOOTPRINT_K·radius². Used to size a pin from a sheet
 *  target SQF (inverse: radius ≈ √(targetArea / FOOTPRINT_K)). */
const FOOTPRINT_K = Math.PI * 0.536

/** Intent "Adjust": a fully-Density area adds up to this many rooms to a department; a fully-
 *  Openness area removes up to this many (like clicking the room-count up/down). */
const MAX_INTENT_DELTA = 4
const INTENT_COUNT_CAP = 60
/** Minimum averaged intent field over a department before "Adjust" touches its room count. */
const INTENT_MIN_TOTAL = 0.15

const HISTORY_LIMIT = 100
/** Rooms a department starts with the first time the Rooms layer is opened, when the user
 *  hasn't set a grain or count yet (dev/testing default — deterministic, not grain-derived). */
const DEFAULT_ROOM_COUNT = 6

/**
 * One undo/redo step. Captures the FULL multi-board world at the moment before an
 * action: the active board's document, which board was active, and the canvas list
 * + the other boards' documents. This lets a single global timeline cover both
 * per-board geometry edits AND structural actions like creating a board.
 */
interface HistoryEntry {
  activeDoc: CanvasDoc
  activeCanvasId: string
  canvases: CanvasEntry[]
  inactiveCanvasDocs: Record<string, CanvasDoc>
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

/** Transient state while placing a department zone (center → drag radius → commit). */
/** Transient state while placing a department (center → type → radius → commit). */
export interface PendingDept {
  x: number
  y: number
  /** Screen position of the placement click, for positioning the type popup. */
  screenX: number
  screenY: number
  phase: 'type' | 'radius'
  deptType: DepartmentType | null
  radius: number
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
  /** Department zones (Stage 3) — blending program fields masked to boundary∩¬circ. */
  departments: Department[]
  /** Transient department being placed (center set, sizing radius), or null. */
  pendingDept: PendingDept | null
  /** Generated room sub-polygons (Stage 4), each owned by a parent department. */
  rooms: Room[]
  lotGridSeams: { x: number; y: number }[][]
  /** Free-floating text annotations. */
  textLabels: TextLabel[]
  /** Transient text being placed/edited, or null. */
  pendingText: PendingText | null
  /** Committed freehand scribbles (raster annotations; not part of the graph). */
  scribbles: ScribbleStroke[]
  /** The scribble currently being drawn (transient; not in undo history). */
  liveScribble: ScribbleStroke | null
  /** When true, every pin shows its intent-type label (driven by toolbar hover). */
  showIntentLabels: boolean
  /** When true, overlay a grid of region intent-concentration percentages
   *  (driven by toolbar hover over the Intent Pin button). */
  showIntentGrid: boolean
  /** Artboard (page sheet) size in world units. Independent world coordinate
   *  frame — NOT driven by imports; only the user/default sets it. */
  pageWidth: number
  pageHeight: number
  /** Editable title shown at the artboard's bottom-right corner. */
  sheetName: string
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
  /** Active pipeline layer (Gradia restructure — right-panel Layer Navigator). */
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
  /** Opacity (0..1) of the lot-boundary interior fill. */
  boundaryInfillOpacity: number
  /** Show the edge-aligned structural grid inside the closed lot (Boundary layer). */
  lotGridVisible: boolean
  /** Show the placed Intent Pins + their metaball field on the Rooms layer (panel toggle). */
  intentPinsVisible: boolean
  /** Structural grid module spacing (world units). */
  lotGridSpacing: number
  /** Circulation centerlines (Stage 2). */
  circulationPaths: CirculationPath[]
  /** Main corridor width (world units) applied to new/unlocked MAIN paths. */
  circulationWidth: number
  /** Minor (smaller) corridor width applied to new/unlocked MINOR paths. */
  circulationMinorWidth: number
  /** Which pathway tier the Polyline tool draws on the Circulation layer. */
  circulationTier: CirculationTier
  /** Derived MAIN keep-out mask: one band ring per MAIN path (point-in-any-band).
   *  Null when there are no main corridors. The Stage-3 department hard-mask subtracts
   *  this. Recomputed whenever the circulation set changes. */
  mainCirculationMask: { x: number; y: number }[][] | null
  /** Derived MINOR keep-out mask (smaller connectors). Cached for the Stage-4 room
   *  carve-out; department fields are permeable to it. Null when none. */
  minorCirculationMask: { x: number; y: number }[][] | null
  /** Master object-snapping switch (Cluster 4). When false, the Polyline and
   *  Vector-Edit snap pipelines short-circuit to raw pointer input. Default on. */
  snappingEnabled: boolean
  /** Polyline construction GUIDES (perp/parallel/intersection/midpoint/extension/track +
   *  their visuals). When off, those guides are suppressed but vertex-to-vertex and
   *  vertex-to-edge object snaps still engage (silently). Default on. */
  snapGuidesEnabled: boolean
  /** Object-snap tracking (O-TRACK) anchors acquired by the Polyline tool by
   *  hovering a vertex/midpoint. Capped at 2; alignment rays project from these.
   *  Transient — cleared on path completion, cancel, or leaving the polyline tool. */
  trackedPoints: Array<{ id: string; coords: [number, number] }>;
  /** Undo/redo stacks: snapshots of graph + locks + pins before each action. */
  past: HistoryEntry[]
  future: HistoryEntry[]

  /** All design-option canvases (incl. the active one), with their world origins. */
  canvases: CanvasEntry[]
  /** Which canvas's document is currently live in the top-level fields above. */
  activeCanvasId: string
  /** Snapshotted documents for the NON-active canvases (rendered read-only). */
  inactiveCanvasDocs: Record<string, CanvasDoc>

  /** Spawn a neighbor canvas adjacent to the active one in a cardinal direction
   *  (spaced by CANVAS_GAP so they never touch). `mode` chooses a blank slate or a
   *  full copy of the current board (geometry translated to the new location).
   *  Does not switch focus. */
  addCanvas: (direction: CardinalDirection, mode?: CanvasInitMode) => void
  /** Make a canvas active: snapshot the current live document, load the target's. */
  setActiveCanvas: (id: string) => void

  /** Write the active snap guide (or clear it by passing null). Called each pointer-move frame by the polyline snapping pipeline. */
  setSnapGuide: (guide: SnapGuide | null) => void
  /** Flip the master snapping switch. Clears any live guide when turning off so
   *  on-canvas cues vanish instantly. */
  toggleSnapping: () => void
  setSnapGuidesEnabled: (on: boolean) => void
  /** Acquire an O-TRACK anchor (no-op if already tracked); caps at 2, dropping
   *  the oldest. */
  addTrackedPoint: (id: string, coords: [number, number]) => void
  /** Drop all O-TRACK anchors. */
  clearTrackedPoints: () => void
  setTool: (tool: ToolMode) => void
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
  /** Set the target area (drives the delta readout + the area lock); undefined clears it. */
  setBoundaryTargetSqf: (sqf: number | undefined) => void
  /** Re-fit the closed lot to its target area by uniformly scaling about its centroid
   *  (shape preserved). No-op without a positive target on a closed ring. Undoable. */
  fitBoundaryToTarget: () => void
  /** Set the lot-boundary interior fill opacity (0..1). */
  setBoundaryInfillOpacity: (opacity: number) => void
  setLotGridVisible: (visible: boolean) => void
  setIntentPinsVisible: (visible: boolean) => void
  setLotGridSpacing: (spacing: number) => void
  /** Add a grid seam (open polyline) that splits the lot grid into regions. Undoable. */
  addLotGridSeam: (points: { x: number; y: number }[]) => void
  /** Remove all grid seams (back to a single grid). Undoable. */
  clearLotGridSeams: () => void
  /** Add a circulation centerline (uses the current global width); rebuilds mask. */
  addCirculationPath: (centerline: { x: number; y: number }[]) => void
  /** Remove all circulation paths; rebuilds mask. */
  clearCirculation: () => void
  /** Set the MAIN corridor width; re-offsets MAIN paths + rebuilds masks. */
  setCirculationWidth: (width: number) => void
  /** Set the MINOR corridor width; re-offsets MINOR paths + rebuilds masks. */
  setCirculationMinorWidth: (width: number) => void
  /** Choose which tier new polyline circulation paths are drawn at. */
  setCirculationTier: (tier: CirculationTier) => void
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
  /** Live-move an intent pin (Edit tool drag; no per-move history). */
  setIntentPinPoint: (id: string, x: number, y: number) => void
  /** Erase the first intent pin within `r` of (x,y) — only on the Intent layer. Its
   *  own undo step; returns true if a pin was removed (mirrors eraseSegmentAt). */
  eraseIntentPinAt: (x: number, y: number, r: number) => boolean
  // Intent pin placement flow.
  beginPin: (x: number, y: number, screenX: number, screenY: number) => void
  setPinType: (intentType: IntentType) => void
  setPinRadius: (radius: number) => void
  commitPin: () => void
  cancelPin: () => void
  // Department zone placement flow (Stage 3) + edits: center → type popup → radius → commit.
  beginDept: (x: number, y: number, screenX: number, screenY: number) => void
  setDeptType: (deptType: DepartmentType) => void
  setDeptRadius: (radius: number) => void
  commitDept: () => void
  cancelDept: () => void
  removeDepartment: (id: string) => void
  /** Erase the first department within `r` of (x,y) — only on the Departments layer. Its
   *  own undo step; regenerates rooms; returns true if one was removed. */
  eraseDepartmentAt: (x: number, y: number, r: number) => boolean
  /** Erase the room WALL under (x,y) — only on the Rooms layer: merges the two same-department
   *  rooms sharing that wall into one (count drops; the survivor fills the space in the dept
   *  color). Its own undo step; returns true if a wall was erased. */
  eraseRoomWallAt: (x: number, y: number, r: number) => boolean
  /** Live-move a department center (Edit tool drag; no per-move history). */
  setDepartmentPoint: (id: string, x: number, y: number) => void
  renameDepartment: (id: string, name: string) => void
  setDepartmentColor: (id: string, color: string) => void
  setDepartmentTarget: (id: string, targetSqf: number | undefined) => void
  /** Set a department's parametric room count N (manual override; clears grain) and
   *  regenerate its rooms (Stage 4). */
  setRoomCount: (deptId: string, n: number) => void
  /** Set a department's subdivision grain ∈ [0,1] (0 = open-plan, 1 = cellular) — the primary
   *  room control; the effective room count is derived from the footprint area. Clears any
   *  manual roomCount and regenerates (Stage 4). */
  setDeptGrain: (deptId: string, grain: number) => void
  /** "Adjust": nudge each department's ROOM COUNT from the placed Intent Pins — Density-dominant
   *  areas add rooms, Openness-dominant remove them (like clicking the count up/down). Locked
   *  rooms are ignored; regenerates. */
  applyIntentToRooms: () => void
  /** Toggle a room's locked (frozen) state. Locked rooms survive regeneration and become
   *  keep-outs the unlocked rooms reflow around (4.5.2). No reflow on toggle. */
  toggleRoomLock: (roomId: string) => void
  /** Lock tool on the Rooms layer: toggle the lock of the room whose interior contains (x,y).
   *  Locked rooms are shielded from the Intent "Adjust" regeneration. */
  toggleRoomLockAt: (x: number, y: number) => void
  /** Unlock every locked room (one undo step). */
  clearRoomLocks: () => void
  /** Program Sheet (§3 TAB 3): give a room a name (transient — cleared on regeneration). */
  renameRoom: (roomId: string, name: string) => void
  /** Program Sheet "Split Room" (§3 TAB 3 / Stage 4.4): bisect one room into two grid-aligned
   *  equal-area halves in place (no full re-slice). */
  splitRoom: (roomId: string) => void
  /** Program Sheet "Merge" (§3 TAB 3): merge a room into its best adjacent same-department
   *  neighbor in place. */
  mergeRoom: (roomId: string) => void
  /** Program Sheet (§3 TAB 2): set a department's target SQF AND fit its pin diameter to that
   *  target (the sheet "constrains" the pin), regenerating rooms. Clearing the target frees it. */
  applyDepartmentTarget: (id: string, targetSqf: number | undefined) => void
  /** Begin a Rooms-layer corner drag at (x, y): split any neighbor edge passing through the
   *  point (T-junction stickiness) and return the drag rig (welded anchors + sliding
   *  T-junction vertices) that moves together so no gaps open. */
  beginRoomCornerDrag: (x: number, y: number, eps: number) => DragRig
  /** Apply per-vertex moves from a Rooms-layer corner drag — manual edit (transient;
   *  overwritten on the next room regeneration). One undo step is bracketed by the hook. */
  setRoomVertices: (updates: VertexUpdate[]) => void
  // Text placement flow.
  beginText: (x: number, y: number, screenX: number, screenY: number, id: string | null, initial: string) => void
  commitText: (value: string) => void
  cancelText: () => void
  /** Delete an entire text label (used by the eraser); records one undo step. */
  eraseTextLabel: (id: string) => void
  /** Commit a finished freehand scribble (raster annotation); records one undo step. */
  addScribble: (points: { x: number; y: number }[], color: string, width: number) => void
  /** Set the in-progress scribble preview (transient; no undo history). */
  setLiveScribble: (stroke: ScribbleStroke | null) => void
  /** Delete an entire scribble (Figma-style whole-stroke erase); records one undo step. */
  eraseScribble: (id: string) => void
  /** Move a text label (used by the Edit tool drag); no undo history per move. */
  moveText: (id: string, x: number, y: number) => void
  setShowIntentLabels: (show: boolean) => void
  setShowIntentGrid: (show: boolean) => void
  /** Rename the current artboard (sheet title). */
  setSheetName: (name: string) => void
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
  /** Move one lot-boundary ring vertex live (Edit tool drag); no undo history per
   *  move — the caller snapshots once on grab via beginHistory(). */
  setBoundaryPoint: (index: number, x: number, y: number) => void
  /** Move one circulation centerline vertex live (Edit tool drag); rebuilds the
   *  corridor mask; no undo history per move (caller snapshots on grab). */
  setCirculationPoint: (pathId: string, index: number, x: number, y: number) => void

  /** Snapshot current state onto the undo stack (call once at the start of an action). */
  beginHistory: () => void
  /** Replace the graph without touching history (used mid-action, e.g. erasing). */
  setGraph: (graph: Graph) => void
  /** Commit a finished stroke (records one undo step). `straight` = polyline. */
  commitStroke: (points: SamplePoint[], color: string, raw?: RawSample[], straight?: boolean) => void
  /** Erase along the swept capsule (caller manages history for the drag). */
  eraseCapsule: (ax: number, ay: number, bx: number, by: number, r: number) => boolean
  /** Polyline segment eraser: delete the nearest polyline segment within `r` of
   *  (x,y) — a graph straight-stroke edge or a circulation centerline segment —
   *  dropping any lone leftover vertex. Skips scribbles and the boundary. Returns
   *  whether a segment was deleted. */
  eraseSegmentAt: (x: number, y: number, r: number) => boolean
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
  strokeColor: '#1a1a1a',
  baseWidth: 2,
  lineStyle: 'solid',
  graph: emptyGraph(),
  spatialIndex: buildSnapIndex(emptyGraph()),
  selectedStrokeIds: [],
  lockPolygons: [],
  intentPins: [],
  pendingPin: null,
  departments: [],
  pendingDept: null,
  rooms: [],
  lotGridSeams: [],
  textLabels: [],
  pendingText: null,
  scribbles: [],
  liveScribble: null,
  showIntentLabels: false,
  showIntentGrid: false,
  pageWidth: DEFAULT_PAGE_WIDTH,
  pageHeight: DEFAULT_PAGE_HEIGHT,
  sheetName: 'Board 01',
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
  boundaryInfillOpacity: 0.15,
  lotGridVisible: true,
  intentPinsVisible: true,
  lotGridSpacing: 32,
  circulationPaths: [],
  circulationWidth: 12,
  circulationMinorWidth: 6,
  circulationTier: 'MAIN',
  mainCirculationMask: null,
  minorCirculationMask: null,
  snappingEnabled: true,
  snapGuidesEnabled: true,
  trackedPoints: [],
  past: [],
  future: [],

  canvases: [{ id: 'canvas-central', origin: { x: 0, y: 0 } }],
  activeCanvasId: 'canvas-central',
  inactiveCanvasDocs: {},

  addCanvas: (direction, mode = 'blank') =>
    set((state) => {
      const active = state.canvases.find((c) => c.id === state.activeCanvasId)
      if (!active) return {}
      const w = state.pageWidth
      const h = state.pageHeight
      const origin = freeOriginInDirection(state, active.origin, direction, w, h)
      const id = `canvas-${Date.now()}-${canvasCounter++}`
      const name = `Board ${String(state.canvases.length + 1).padStart(2, '0')}`
      // 'copy' branches the current board: clone its full document and translate all
      // (absolute-world-coord) geometry by the offset to the new board's location, so
      // the duplicate sits in its own slot rather than on top of the original.
      const doc =
        mode === 'copy'
          ? {
              ...translateCanvasDoc(captureCanvasDoc(state), origin.x - active.origin.x, origin.y - active.origin.y),
              sheetName: name,
            }
          : blankCanvasDoc(w, h, name)
      return {
        // Creating a board is undoable: snapshot the pre-creation world first.
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        canvases: [...state.canvases, { id, origin }],
        inactiveCanvasDocs: { ...state.inactiveCanvasDocs, [id]: doc },
      }
    }),
  setActiveCanvas: (id) =>
    set((state) => {
      if (id === state.activeCanvasId) return {}
      const targetDoc = state.inactiveCanvasDocs[id]
      if (!targetDoc) return {}
      // Snapshot the current live document into the inactive map, then load the
      // target's document into the live top-level fields.
      const inactive = { ...state.inactiveCanvasDocs, [state.activeCanvasId]: captureCanvasDoc(state) }
      delete inactive[id]
      return {
        ...applyCanvasDoc(targetDoc),
        activeCanvasId: id,
        inactiveCanvasDocs: inactive,
        // A board still at the Context layer has no substrate yet — drop to Pan so it
        // reads as a fresh "choose a substrate" setup rather than a live draw tool.
        toolMode: targetDoc.activeLayer === 'CONTEXT' ? 'PAN' : state.toolMode,
      }
    }),

  setSnapGuide: (guide) => set({ activeSnapGuide: guide }),
  toggleSnapping: () =>
    set((state) => ({
      snappingEnabled: !state.snappingEnabled,
      // Turning snapping OFF should wipe any guide still on screen.
      activeSnapGuide: state.snappingEnabled ? null : state.activeSnapGuide,
    })),
  setSnapGuidesEnabled: (on) =>
    set((state) => ({
      snapGuidesEnabled: on,
      activeSnapGuide: on ? state.activeSnapGuide : null, // clear any visible guide when turning off
    })),
  addTrackedPoint: (id, coords) =>
    set((state) => {
      if (state.trackedPoints.some((p) => p.id === id)) return {}
      return { trackedPoints: [...state.trackedPoints, { id, coords }].slice(-2) }
    }),
  clearTrackedPoints: () =>
    set((state) => (state.trackedPoints.length ? { trackedPoints: [] } : {})),
  setTool: (tool) =>
    set((state) => {
      const base = {
        toolMode: tool,
        // Leaving the selection tools clears the highlight so it doesn't linger.
        selectedStrokeIds: SELECTION_TOOLS.has(tool) ? state.selectedStrokeIds : [],
        // Abandon any in-progress pin/text placement when leaving those tools.
        pendingPin: tool === 'INTENT_PIN' ? state.pendingPin : null,
        pendingText: tool === 'TEXT' ? state.pendingText : null,
        // Clear any active snap guide + O-TRACK anchors when leaving the polyline tool.
        activeSnapGuide: tool === 'POLYLINE' ? state.activeSnapGuide : null,
        trackedPoints: tool === 'POLYLINE' ? state.trackedPoints : [],
      }
      // Leaving the Edit tool: re-trim circulation centerlines back inside the lot
      // boundary, since vertex edits (to a corridor OR to the boundary itself) may
      // have pushed parts outside — same clipping the Polyline tool applies on
      // commit. Recorded as one undo step.
      if (state.toolMode === 'VECTOR' && tool !== 'VECTOR') {
        const trimmed = trimCirculationToBoundary(state)
        if (trimmed) {
          return {
            ...base,
            past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
            future: [],
            ...trimmed,
          }
        }
      }
      return base
    }),
  setActiveLayer: (layer) =>
    set((state) => {
      const base = {
        activeLayer: layer,
        maxLayerReached: Math.max(state.maxLayerReached, LAYER_ORDER.indexOf(layer)),
      }
      // Cascade (restructure_v2 4.5): rooms are derived from the boundary, circulation,
      // and departments — all edited on OTHER layers. Re-derive them on entry to the
      // Rooms layer so a moved/resized department or an edited corridor re-flows the
      // rooms automatically (locked rooms are preserved; isLocked editing lands later).
      if (layer === 'ROOMS' && state.departments.length > 0) {
        // Any department with no room intent yet defaults to DEFAULT_ROOM_COUNT rooms (a fixed
        // dev/testing default), so opening the layer immediately fills every department. An
        // explicit grain or manual roomCount (incl. 0) the user set earlier is kept; once the
        // user drags the grain slider, grain takes over as the primary control.
        const departments = state.departments.map((d) =>
          d.grain == null && d.roomCount == null
            ? { ...d, roomCount: DEFAULT_ROOM_COUNT }
            : d,
        )
        return { ...base, departments, rooms: regenRooms(state, departments) }
      }
      return base
    }),
  setContext: (ctx) => set({ context: ctx, mapActive: ctx === 'MAP' }),
  setGridType: (type) => set({ gridType: type }),
  setGridSpacing: (spacing) => set({ gridSpacing: Math.max(1, Math.round(spacing) || 1) }),
  setBoundary: (ring) =>
    set((state) => {
      // Normalize: drop a trailing point that repeats the first (closed ring).
      const r = ring.slice()
      if (r.length > 1) {
        const a = r[0]
        const b = r[r.length - 1]
        if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) r.pop()
      }
      if (r.length < 3) return {}
      // A freshly committed boundary is a complete closed loop (re-closing it after
      // a segment erase also routes here, restoring isClosed: true).
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        boundary: { ...state.boundary, ring: r, isClosed: true },
      }
    }),
  clearBoundary: () =>
    set((state) => {
      if (!state.boundary) return {}
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        boundary: null,
        lotGridSeams: [], // seams referenced the old lot
      }
    }),
  setBoundaryTargetSqf: (sqf) =>
    // Store the number only (keeps the live readout responsive while typing). The
    // geometry re-fit happens on commit via fitBoundaryToTarget (Enter / blur), so a
    // multi-keystroke entry like "45000" doesn't scale the lot once per character.
    set((state) => (state.boundary ? { boundary: { ...state.boundary, targetSqf: sqf } } : {})),
  fitBoundaryToTarget: () =>
    set((state) => {
      const b = state.boundary
      if (!b || b.isClosed === false || b.ring.length < 3) return {}
      const target = b.targetSqf
      if (target == null || target <= 0) return {}
      const ring = scaleRingToArea(b.ring, sqftToWorldArea(target, state.metersPerWorldUnit))
      if (samePolyline(ring, b.ring)) return {} // already on target — no empty undo step
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        boundary: { ...b, ring },
      }
    }),
  setBoundaryInfillOpacity: (opacity) =>
    set({ boundaryInfillOpacity: Math.max(0, Math.min(1, opacity)) }),
  setLotGridVisible: (visible) => set({ lotGridVisible: visible }),
  setIntentPinsVisible: (visible) => set({ intentPinsVisible: visible }),
  setLotGridSpacing: (spacing) => set({ lotGridSpacing: Math.max(4, Math.round(spacing) || 4) }),
  addLotGridSeam: (points) =>
    set((state) => {
      if (points.length < 2) return {}
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        lotGridSeams: [...state.lotGridSeams, points.map((p) => ({ x: p.x, y: p.y }))],
      }
    }),
  clearLotGridSeams: () =>
    set((state) => {
      if (state.lotGridSeams.length === 0) return {}
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        lotGridSeams: [],
      }
    }),
  addCirculationPath: (centerline) =>
    set((state) => {
      if (centerline.length < 2) return {}
      // Trim to the lot boundary: keep only the portions inside it. A path that
      // exits and re-enters the lot is split into several inside pieces; one that
      // lies entirely outside is dropped. With no boundary, the path is kept as-is.
      const ring =
        state.boundary && state.boundary.isClosed !== false ? state.boundary.ring : undefined
      const pieces =
        ring && ring.length >= 3
          ? clipPolylineToPolygon(centerline, ring)
          : [centerline.map((p) => ({ x: p.x, y: p.y }))]
      if (pieces.length === 0) return {}
      const stamp = Date.now()
      // New paths inherit the active tier and its corresponding width.
      const tier = state.circulationTier
      const width = tier === 'MINOR' ? state.circulationMinorWidth : state.circulationWidth
      const newPaths: CirculationPath[] = pieces.map((pts) => ({
        id: `circ-${stamp}-${circulationCounter++}`,
        centerline: pts,
        width,
        tier,
      }))
      const circulationPaths = [...state.circulationPaths, ...newPaths]
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        circulationPaths,
        ...circMasks(circulationPaths),
      }
    }),
  clearCirculation: () =>
    set((state) => {
      if (state.circulationPaths.length === 0) return {} // nothing to remove
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        circulationPaths: [],
        mainCirculationMask: null,
        minorCirculationMask: null,
      }
    }),
  setCirculationWidth: (width) =>
    set((state) => {
      const w = Math.max(1, width)
      // Re-offset only MAIN paths (tier absent ⇒ MAIN for back-compat).
      const circulationPaths = state.circulationPaths.map((p) =>
        p.tier === 'MINOR' ? p : { ...p, width: w },
      )
      return {
        circulationWidth: w,
        circulationPaths,
        ...circMasks(circulationPaths),
      }
    }),
  setCirculationMinorWidth: (width) =>
    set((state) => {
      const w = Math.max(1, width)
      const circulationPaths = state.circulationPaths.map((p) =>
        p.tier === 'MINOR' ? { ...p, width: w } : p,
      )
      return {
        circulationMinorWidth: w,
        circulationPaths,
        ...circMasks(circulationPaths),
      }
    }),
  setCirculationTier: (tier) => set({ circulationTier: tier }),
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
  setIntentPinPoint: (id, x, y) =>
    set((state) => {
      let changed = false
      const intentPins = state.intentPins.map((p) => {
        if (p.id !== id) return p
        changed = true
        return { ...p, x, y }
      })
      return changed ? { intentPins } : {}
    }),
  eraseIntentPinAt: (x, y, r) => {
    const state = get()
    // Intent pins now live on the Rooms layer, so they're only erasable there.
    if (state.activeLayer !== 'ROOMS') return false
    const r2 = r * r
    const hit = state.intentPins.find((p) => {
      const dx = p.x - x
      const dy = p.y - y
      return dx * dx + dy * dy <= r2
    })
    if (!hit) return false
    set((s) => ({
      past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
      future: [],
      intentPins: s.intentPins.filter((p) => p.id !== hit.id),
    }))
    return true
  },
  eraseDepartmentAt: (x, y, r) => {
    const state = get()
    // Departments are the Departments layer's content, so they're only erasable there.
    if (state.activeLayer !== 'DEPARTMENTS') return false
    const r2 = r * r
    const hit = state.departments.find((d) => {
      const dx = d.x - x
      const dy = d.y - y
      return dx * dx + dy * dy <= r2
    })
    if (!hit) return false
    set((s) => {
      const departments = s.departments.filter((d) => d.id !== hit.id)
      return {
        past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
        future: [],
        departments,
        // Regenerate so neighbors reflow into the freed space (mirrors removeDepartment).
        rooms: regenRooms(s, departments),
      }
    })
    return true
  },
  eraseRoomWallAt: (x, y, r) => {
    const state = get()
    // Walls belong to the Rooms layer; no-op elsewhere so the eraser can try this safely.
    if (state.activeLayer !== 'ROOMS') return false
    const res = mergeRoomsAtWall(state.rooms, x, y, r)
    if (!res) return false
    set((s) => {
      // Pin every AFFECTED department's target to its new room count (clearing grain, like
      // setRoomCount) so the displayed counts stay consistent and a later regen won't silently
      // re-add the wall. (Erasing a department-border wall changes both departments' counts.)
      // The merge geometry itself is transient — overwritten on the next regeneration.
      const departments = s.departments.map((d) =>
        res.affected.includes(d.id)
          ? { ...d, roomCount: res.rooms.filter((rm) => rm.parentDeptId === d.id).length, grain: undefined }
          : d,
      )
      return {
        past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
        future: [],
        rooms: res.rooms,
        departments,
      }
    })
    return true
  },

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

  beginDept: (x, y, screenX, screenY) =>
    set({ pendingDept: { x, y, screenX, screenY, phase: 'type', deptType: null, radius: 60 } }),
  setDeptType: (deptType) =>
    set((state) => (state.pendingDept ? { pendingDept: { ...state.pendingDept, deptType, phase: 'radius' } } : {})),
  setDeptRadius: (radius) =>
    set((state) => (state.pendingDept ? { pendingDept: { ...state.pendingDept, radius } } : {})),
  commitDept: () =>
    set((state) => {
      const p = state.pendingDept
      if (!p || !p.deptType) return { pendingDept: null }
      const meta = DEPARTMENT_META[p.deptType]
      const dept: Department = {
        id: `dept-${Date.now()}-${deptCounter++}`,
        deptType: p.deptType,
        // Named + colored from the chosen program type (name editable in the panel; the
        // color is fixed for service types like Core/Mechanical, otherwise editable).
        name: meta.label,
        x: p.x,
        y: p.y,
        radius: Math.max(12, p.radius),
        color: meta.color,
      }
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        departments: [...state.departments, dept],
        pendingDept: null,
      }
    }),
  cancelDept: () => set({ pendingDept: null }),
  removeDepartment: (id) =>
    set((state) => {
      const departments = state.departments.filter((d) => d.id !== id)
      // Regenerate so neighboring departments' power cells reflow into the freed space.
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        departments,
        rooms: regenRooms(state, departments),
      }
    }),
  setRoomCount: (deptId, n) =>
    set((state) => {
      if (!state.departments.some((d) => d.id === deptId)) return {}
      const count = Math.max(0, Math.floor(n))
      // Room domains are a power-diagram partition over the whole plan (Pass 1), so a
      // change re-derives every department's rooms together — each respects main
      // corridors as hard walls and never overlaps a neighbor. Typing an explicit N clears
      // grain so the count is taken verbatim (grain is the derived-count control).
      const departments = state.departments.map((d) =>
        d.id === deptId ? { ...d, roomCount: count, grain: undefined } : d,
      )
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        departments,
        rooms: regenRooms(state, departments),
      }
    }),
  setDeptGrain: (deptId, grain) =>
    set((state) => {
      if (!state.departments.some((d) => d.id === deptId)) return {}
      const g = Math.min(1, Math.max(0, grain))
      // grain is the PRIMARY room control: the generator derives each department's effective
      // room count from its footprint area and grain (open-plan → few large, cellular → many
      // small). Setting grain clears any manual roomCount override.
      const departments = state.departments.map((d) =>
        d.id === deptId ? { ...d, grain: g, roomCount: undefined } : d,
      )
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        departments,
        rooms: regenRooms(state, departments),
      }
    }),
  applyIntentToRooms: () =>
    set((state) => {
      if (state.intentPins.length === 0) return {}
      // Intent "Adjust" nudges each department's ROOM COUNT exactly like the user clicking the
      // count up/down: where the painted field is DENSITY-dominant over a department's rooms it
      // adds rooms, where it's OPENNESS-dominant it removes them. Locked rooms are ignored (kept
      // as keep-outs by regenRooms; only the UNLOCKED count is the baseline that moves).
      const roomsByDept = new Map<string, Room[]>()
      for (const r of state.rooms) {
        const arr = roomsByDept.get(r.parentDeptId)
        if (arr) arr.push(r)
        else roomsByDept.set(r.parentDeptId, [r])
      }
      const departments = state.departments.map((d) => {
        const drooms = roomsByDept.get(d.id) ?? []
        // Sample the intent over the department's ROOMS (their centroids) — i.e. "how much of
        // this department sits in the painted area" — falling back to the pin if it has no rooms.
        const pts = drooms.length
          ? drooms.map((r) => {
              let cx = 0
              let cy = 0
              for (const p of r.polygon) {
                cx += p.x
                cy += p.y
              }
              return { x: cx / r.polygon.length, y: cy / r.polygon.length }
            })
          : [{ x: d.x, y: d.y }]
        let dens = 0
        let open = 0
        let tot = 0
        for (const p of pts) {
          const { total, mix } = getIntentConcentration(p.x, p.y, state.intentPins)
          dens += mix.DENSITY
          open += mix.OPENNESS
          tot += total
        }
        if (tot / pts.length < INTENT_MIN_TOTAL) return d // not enough intent over this department
        const net = (dens - open) / pts.length // +1 = pure density, −1 = pure openness
        const delta = Math.round(net * MAX_INTENT_DELTA)
        if (delta === 0) return d
        const base = drooms.filter((r) => !r.isLocked).length || d.roomCount || 0
        const newCount = Math.max(1, Math.min(INTENT_COUNT_CAP, base + delta))
        return { ...d, roomCount: newCount, grain: undefined }
      })
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        departments,
        rooms: regenRooms(state, departments),
      }
    }),
  toggleRoomLock: (roomId) =>
    set((state) => {
      if (!state.rooms.some((r) => r.roomId === roomId)) return {}
      // A freeze, not a reflow: just flip the flag (one undo step). The NEXT regeneration
      // (grain/count change, department edit, layer re-entry) treats locked rooms as keep-outs.
      const rooms = state.rooms.map((r) => (r.roomId === roomId ? { ...r, isLocked: !r.isLocked } : r))
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        rooms,
      }
    }),
  toggleRoomLockAt: (x, y) =>
    set((state) => {
      if (state.activeLayer !== 'ROOMS') return {}
      // Topmost room (later rooms render on top) whose interior contains the point.
      let hit: Room | undefined
      for (let i = state.rooms.length - 1; i >= 0; i--) {
        if (pointInPolygon(x, y, state.rooms[i].polygon)) {
          hit = state.rooms[i]
          break
        }
      }
      if (!hit) return {}
      const id = hit.roomId
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        rooms: state.rooms.map((r) => (r.roomId === id ? { ...r, isLocked: !r.isLocked } : r)),
      }
    }),
  clearRoomLocks: () =>
    set((state) => {
      if (!state.rooms.some((r) => r.isLocked)) return {}
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        rooms: state.rooms.map((r) => (r.isLocked ? { ...r, isLocked: false } : r)),
      }
    }),
  renameRoom: (roomId, name) =>
    set((state) => {
      if (!state.rooms.some((r) => r.roomId === roomId)) return {}
      const trimmed = name.trim()
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        rooms: state.rooms.map((r) => (r.roomId === roomId ? { ...r, name: trimmed || undefined } : r)),
      }
    }),
  splitRoom: (roomId) =>
    set((state) => {
      const room = state.rooms.find((r) => r.roomId === roomId)
      if (!room || room.isLocked) return {}
      const res = splitRoomGeom(
        room,
        state.boundary,
        state.metersPerWorldUnit,
        `room-${Date.now()}-${roomActionSeq++}`,
        `room-${Date.now()}-${roomActionSeq++}`,
      )
      if (!res) return {}
      // Replace the one room with its two halves in place (no full department re-slice).
      const rooms = state.rooms.flatMap((r) => (r.roomId === roomId ? [res.a, res.b] : [r]))
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        rooms,
      }
    }),
  mergeRoom: (roomId) =>
    set((state) => {
      const res = mergeRoomWithNeighbor(state.rooms, roomId)
      if (!res) return {}
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        rooms: res.rooms,
      }
    }),
  applyDepartmentTarget: (id, targetSqf) =>
    set((state) => {
      if (!state.departments.some((d) => d.id === id)) return {}
      const fit = targetSqf != null && targetSqf > 0
      const radius = fit
        ? Math.max(12, Math.sqrt(Math.max(1, sqftToWorldArea(targetSqf, state.metersPerWorldUnit)) / FOOTPRINT_K))
        : null
      // Setting a target SIZES the pin to it (the sheet constraint); clearing only drops the goal.
      const departments = state.departments.map((d) =>
        d.id === id ? { ...d, targetSqf, ...(radius != null ? { radius } : {}) } : d,
      )
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        departments,
        rooms: regenRooms(state, departments),
      }
    }),
  beginRoomCornerDrag: (x, y, eps) => {
    let rig: DragRig = { anchors: [], sliders: [] }
    set((state) => {
      const splits = findEdgeSplits(state.rooms, x, y, eps)
      const rooms = splits.length > 0 ? applyEdgeSplits(state.rooms, splits) : state.rooms
      // Build the rig on the post-split rings (by position), so inserted T-junction vertices
      // move with the original coincident corners.
      rig = buildDragRig(rooms, x, y, eps)
      return splits.length > 0 ? { rooms } : {}
    })
    return rig
  },
  setRoomVertices: (updates) =>
    set((state) => {
      if (updates.length === 0) return {}
      const moved = new Map<string, Map<number, { x: number; y: number }>>()
      for (const u of updates) {
        let m = moved.get(u.roomId)
        if (!m) moved.set(u.roomId, (m = new Map()))
        m.set(u.index, { x: u.x, y: u.y })
      }
      const mpu = state.metersPerWorldUnit
      const hasScale = mpu != null && mpu > 0
      const rooms = state.rooms.map((r) => {
        const m = moved.get(r.roomId)
        if (!m) return r
        const polygon = r.polygon.map((p, i) => m.get(i) ?? p)
        const areaWorld = polygonAreaWorld(polygon)
        return { ...r, polygon, areaSqf: hasScale ? worldAreaToSqft(areaWorld, mpu) : areaWorld }
      })
      return { rooms }
    }),
  setDepartmentPoint: (id, x, y) =>
    set((state) => {
      let changed = false
      const departments = state.departments.map((d) => {
        if (d.id !== id) return d
        changed = true
        return { ...d, x, y }
      })
      return changed ? { departments } : {}
    }),
  // Metadata edits (name/color/target) are live with no per-keystroke history.
  renameDepartment: (id, name) =>
    set((state) => ({ departments: state.departments.map((d) => (d.id === id ? { ...d, name } : d)) })),
  setDepartmentColor: (id, color) =>
    set((state) => ({
      departments: state.departments.map((d) =>
        // Core / Mechanical keep their fixed grey / black — never recolored.
        d.id === id && !(d.deptType && FIXED_COLOR_DEPT_TYPES.has(d.deptType)) ? { ...d, color } : d,
      ),
    })),
  setDepartmentTarget: (id, targetSqf) =>
    set((state) => ({ departments: state.departments.map((d) => (d.id === id ? { ...d, targetSqf } : d)) })),

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
        size: 14,
      }
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        textLabels: [...state.textLabels, label],
        pendingText: null,
      }
    }),
  cancelText: () => set({ pendingText: null }),
  eraseTextLabel: (id) =>
    set((state) => {
      if (!state.textLabels.some((l) => l.id === id)) return {}
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        textLabels: state.textLabels.filter((l) => l.id !== id),
      }
    }),
  addScribble: (points, color, width) =>
    set((state) => {
      if (points.length < 1) return {}
      const stroke: ScribbleStroke = {
        id: `scribble-${Date.now()}-${scribbleCounter++}`,
        color,
        width,
        points: points.map((p) => ({ x: p.x, y: p.y })),
      }
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        scribbles: [...state.scribbles, stroke],
        liveScribble: null,
      }
    }),
  setLiveScribble: (stroke) => set({ liveScribble: stroke }),
  eraseScribble: (id) =>
    set((state) => {
      if (!state.scribbles.some((s) => s.id === id)) return {}
      return {
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        scribbles: state.scribbles.filter((s) => s.id !== id),
      }
    }),
  moveText: (id, x, y) =>
    set((state) => ({ textLabels: state.textLabels.map((l) => (l.id === id ? { ...l, x, y } : l)) })),
  setShowIntentLabels: (show) => set({ showIntentLabels: show }),
  setShowIntentGrid: (show) => set({ showIntentGrid: show }),
  setSheetName: (name) => set({ sheetName: name }),
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
  setBoundaryPoint: (index, x, y) =>
    set((state) => {
      if (!state.boundary) return {}
      const ring = state.boundary.ring
      if (index < 0 || index >= ring.length) return {}
      const next = ring.slice()
      next[index] = { x, y }
      // Area lock: with a target set on a closed lot, the corner the user grabs stays
      // exactly where they (snapped) it, while the REST of the polygon scales uniformly
      // about that corner to hold the target area. Scaling about the dragged vertex
      // keeps it fixed and changes area by the square of the scale — one sqrt re-locks
      // it each frame (no history per move, matching the rest of the drag hot path).
      const target = state.boundary.targetSqf
      if (target != null && target > 0 && state.boundary.isClosed !== false && next.length >= 3) {
        const locked = scaleRingToArea(next, sqftToWorldArea(target, state.metersPerWorldUnit), next[index])
        return { boundary: { ...state.boundary, ring: locked } }
      }
      return { boundary: { ...state.boundary, ring: next } }
    }),
  setCirculationPoint: (pathId, index, x, y) =>
    set((state) => {
      let changed = false
      const circulationPaths = state.circulationPaths.map((p) => {
        if (p.id !== pathId || index < 0 || index >= p.centerline.length) return p
        const centerline = p.centerline.slice()
        centerline[index] = { x, y }
        changed = true
        return { ...p, centerline }
      })
      if (!changed) return {}
      return { circulationPaths, ...circMasks(circulationPaths) }
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
  eraseSegmentAt: (x, y, r) => {
    const state = get()
    const r2 = r * r
    const inBoundaryLayer = state.activeLayer === 'BOUNDARY'

    // Nearest graph straight-stroke (polyline) segment.
    const gHit = nearestStraightSegment(state.graph, x, y)
    const graphBest = gHit && gHit.distSq <= r2 ? gHit : null

    // Nearest circulation centerline segment — NOT in the Boundary layer, where
    // corridors are only a read-only reference.
    let circBest: { pathId: string; seg: number; distSq: number } | null = null
    if (!inBoundaryLayer) {
      for (const p of state.circulationPaths) {
        const c = p.centerline
        for (let i = 0; i < c.length - 1; i++) {
          const d = pointSegmentDistSq(x, y, c[i], c[i + 1])
          if (d <= r2 && (!circBest || d < circBest.distSq)) circBest = { pathId: p.id, seg: i, distSq: d }
        }
      }
    }

    // Nearest lot-boundary edge — ONLY in the Boundary layer; the boundary is
    // protected everywhere else.
    let bndBest: { seg: number; distSq: number } | null = null
    if (inBoundaryLayer && state.boundary) {
      const closed = state.boundary.isClosed !== false
      bndBest = nearestBoundarySegment(state.boundary.ring, closed, x, y)
      if (bndBest && bndBest.distSq > r2) bndBest = null
    }

    if (!graphBest && !circBest && !bndBest) return false

    // Whichever polyline/boundary segment is globally closest to the cursor wins.
    const bndWins = bndBest && (!graphBest || bndBest.distSq <= graphBest.distSq) && (!circBest || bndBest.distSq <= circBest.distSq)
    if (bndWins) {
      set((s) => {
        if (!s.boundary) return {}
        const closed = s.boundary.isClosed !== false
        const next = eraseBoundarySegment(s.boundary.ring, closed, bndBest!.seg)
        // Drop the whole boundary if nothing erasable survives; otherwise it
        // becomes an OPEN chain that must be re-closed to unlock later layers.
        return {
          past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
          future: [],
          boundary: next ? { ...s.boundary, ring: next.ring, isClosed: next.isClosed } : null,
        }
      })
      return true
    }

    // Whichever polyline segment is globally closest to the cursor wins.
    if (graphBest && (!circBest || graphBest.distSq <= circBest.distSq)) {
      set((s) => ({
        past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
        future: [],
        graph: removeStrokeSegment(s.graph, graphBest.strokeId, graphBest.seg),
      }))
      return true
    }

    // Circulation: split the path at the segment; drop sub-runs of < 2 points
    // (a lone leftover vertex isn't a line). Undoable like the other edits.
    set((s) => {
      const paths: CirculationPath[] = []
      for (const p of s.circulationPaths) {
        if (p.id !== circBest!.pathId) {
          paths.push(p)
          continue
        }
        const c = p.centerline
        for (const run of [c.slice(0, circBest!.seg + 1), c.slice(circBest!.seg + 1)]) {
          if (run.length >= 2) paths.push({ ...p, id: `circ-${Date.now()}-${circulationCounter++}`, centerline: run })
        }
      }
      return {
        past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
        future: [],
        circulationPaths: paths,
        ...circMasks(paths),
      }
    })
    return true
  },
  undo: () =>
    set((state) => {
      if (state.past.length === 0) return {}
      const past = state.past.slice()
      const previous = past.pop()!
      return {
        ...restoreEntry(state, previous),
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
        ...restoreEntry(state, next),
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
        ...restoreEntry(state, previous),
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

/** Full multi-board world snapshot taken before any undoable action. */
/** Re-derive rooms after an upstream change, PRESERVING locked rooms (4.5.2): the locked
 *  rooms are kept verbatim AND fed to the generator as keep-outs, so freshly generated rooms
 *  reflow around the regions the user has frozen instead of overlapping them. */
function regenRooms(state: DrawingState, departments: Department[]): Room[] {
  const locked = state.rooms.filter((r) => r.isLocked)
  const fresh = generateRooms(
    departments,
    state.boundary,
    state.circulationPaths,
    state.metersPerWorldUnit,
    state.lotGridSpacing,
    state.lotGridSeams,
    locked,
  )
  return [...locked, ...fresh]
}

function snapshot(state: DrawingState): HistoryEntry {
  return {
    activeDoc: captureCanvasDoc(state),
    activeCanvasId: state.activeCanvasId,
    canvases: state.canvases,
    inactiveCanvasDocs: state.inactiveCanvasDocs,
  }
}

/** The active board's geometry/feature fields from a doc (the classic undo subset —
 *  deliberately excludes layer/substrate state so undo never re-navigates layers). */
function restoreActiveGeometry(doc: CanvasDoc): Partial<DrawingState> {
  return {
    graph: doc.graph,
    lockPolygons: doc.lockPolygons,
    intentPins: doc.intentPins,
    departments: doc.departments,
    rooms: doc.rooms,
    lotGridSeams: doc.lotGridSeams,
    textLabels: doc.textLabels,
    boundary: doc.boundary,
    circulationPaths: doc.circulationPaths,
    ...circMasks(doc.circulationPaths),
    scribbles: doc.scribbles,
  }
}

/**
 * Restore a history entry. When the entry's active board is still the current one,
 * only its geometry is rolled back (layer/substrate state and the spatial index
 * subscription behave exactly as the single-board app did). When the entry belongs
 * to a DIFFERENT board (e.g. undoing a board creation after switching into it), the
 * whole board is loaded. The canvas list + other boards' docs are always restored,
 * which is what makes board creation/removal undoable.
 */
function restoreEntry(state: DrawingState, entry: HistoryEntry): Partial<DrawingState> {
  const sameBoard = entry.activeCanvasId === state.activeCanvasId
  const docPart = sameBoard ? restoreActiveGeometry(entry.activeDoc) : applyCanvasDoc(entry.activeDoc)
  return {
    ...docPart,
    activeCanvasId: entry.activeCanvasId,
    canvases: entry.canvases,
    inactiveCanvasDocs: entry.inactiveCanvasDocs,
  }
}

// Assemble the non-graph polylines (lot boundary ring + circulation centerlines)
// that should also be snap-able, so the Polyline tool can share their vertices and
// start/end on their edges — same context-aware snapping the boundary trace uses.
function snapExtras(state: {
  boundary: Boundary | null
  circulationPaths: CirculationPath[]
}): ExtraPolyline[] {
  const extras: ExtraPolyline[] = []
  if (state.boundary && state.boundary.ring.length >= 2) {
    extras.push({ id: 'bnd', points: state.boundary.ring, closed: state.boundary.isClosed !== false })
  }
  for (const p of state.circulationPaths) {
    if (p.centerline.length >= 2) extras.push({ id: `circ:${p.id}`, points: p.centerline, closed: false })
  }
  return extras
}

/** True when two polylines have identical points (within a small epsilon). */
function samePolyline(a: { x: number; y: number }[], b: { x: number; y: number }[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].x - b[i].x) > 1e-6 || Math.abs(a[i].y - b[i].y) > 1e-6) return false
  }
  return true
}

/**
 * Tier-split circulation keep-out masks (restructure_v2 Stage 2.2). MAIN paths form the
 * structural barrier the Stage-3 department hard-mask subtracts; MINOR paths are cached
 * separately for the Stage-4 room carve-out (and are permeable to department fields).
 * Each mask is the array of per-path band rings (point-in-any-band ⇒ inside a corridor);
 * see corridor.ts on why this stands in for a Turf-union MultiPolygon here.
 */
function circMasks(paths: CirculationPath[]): {
  mainCirculationMask: { x: number; y: number }[][] | null
  minorCirculationMask: { x: number; y: number }[][] | null
} {
  const main = paths.filter((p) => p.tier !== 'MINOR')
  const minor = paths.filter((p) => p.tier === 'MINOR')
  return {
    mainCirculationMask: main.length ? buildCirculationMask(main) : null,
    minorCirculationMask: minor.length ? buildCirculationMask(minor) : null,
  }
}

/**
 * Clip every circulation centerline to the (closed) lot boundary, keeping only the
 * parts inside it — a path that pokes out is split/shortened, one fully outside is
 * dropped. Returns the new paths + masks, or null when nothing changed (or there's
 * no closed boundary / no paths, so there's nothing to trim).
 */
function trimCirculationToBoundary(
  state: DrawingState,
): {
  circulationPaths: CirculationPath[]
  mainCirculationMask: { x: number; y: number }[][] | null
  minorCirculationMask: { x: number; y: number }[][] | null
} | null {
  const ring = state.boundary && state.boundary.isClosed !== false ? state.boundary.ring : null
  if (!ring || ring.length < 3 || state.circulationPaths.length === 0) return null
  const out: CirculationPath[] = []
  let changed = false
  for (const p of state.circulationPaths) {
    const pieces = clipPolylineToPolygon(p.centerline, ring).filter((pts) => pts.length >= 2)
    if (pieces.length === 1 && samePolyline(pieces[0], p.centerline)) {
      out.push(p) // wholly inside, untouched
      continue
    }
    changed = true
    for (const pts of pieces) {
      out.push({
        id: `circ-${Date.now()}-${circulationCounter++}`,
        centerline: pts.map((pt) => ({ x: pt.x, y: pt.y })),
        width: p.width,
        tier: p.tier,
      })
    }
  }
  if (!changed) return null
  return { circulationPaths: out, ...circMasks(out) }
}

// ─── Multi-canvas (design-option branches) helpers ───────────────────────────

/** A pristine, empty document for a freshly spawned neighbor canvas — starts at the
 *  Context layer with no substrate chosen, exactly like a freshly loaded page. */
function blankCanvasDoc(pageWidth: number, pageHeight: number, sheetName: string): CanvasDoc {
  return {
    graph: emptyGraph(),
    lockPolygons: [],
    intentPins: [],
    departments: [],
    rooms: [],
    lotGridSeams: [],
    textLabels: [],
    scribbles: [],
    boundary: null,
    circulationPaths: [],
    underlay: null,
    pageWidth,
    pageHeight,
    sheetName,
    activeLayer: 'CONTEXT',
    maxLayerReached: 0,
    context: null,
    gridType: 'none',
    gridSpacing: 32,
    boundaryInfillOpacity: 0.15,
    circulationWidth: 12,
    circulationMinorWidth: 6,
    metersPerWorldUnit: null,
    mapActive: false,
    mapDim: 0.35,
    mapGeometry: null,
  }
}

/**
 * Deep-clone a document and translate every absolute-world-coordinate field by
 * (dx, dy). Used by `addCanvas('copy')` so a branched board's geometry lands in the
 * new board's slot instead of on top of the original. The underlay is NOT shifted —
 * its transform is local to the page center (rendered inside the board's offset
 * group) — and mapGeometry is geographic (lng/lat), so both are copied verbatim.
 */
function translateCanvasDoc(doc: CanvasDoc, dx: number, dy: number): CanvasDoc {
  const vertices: Record<string, { id: string; x: number; y: number }> = {}
  for (const id in doc.graph.vertices) {
    const v = doc.graph.vertices[id]
    vertices[id] = { ...v, x: v.x + dx, y: v.y + dy }
  }
  const strokes = doc.graph.strokes.map((s) => ({
    ...s,
    path: s.path.map((pp) => ({ ...pp })),
    raw: s.raw ? s.raw.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })) : s.raw,
  }))
  const shift = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy })
  return {
    ...doc,
    graph: { vertices, strokes },
    boundary: doc.boundary ? { ...doc.boundary, ring: doc.boundary.ring.map(shift) } : null,
    circulationPaths: doc.circulationPaths.map((c) => ({ ...c, centerline: c.centerline.map(shift) })),
    lockPolygons: doc.lockPolygons.map((l) => ({ ...l, points: l.points.map(shift) })),
    intentPins: doc.intentPins.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    departments: doc.departments.map((d) => ({ ...d, x: d.x + dx, y: d.y + dy })),
    rooms: doc.rooms.map((r) => ({ ...r, polygon: r.polygon.map(shift) })),
    lotGridSeams: doc.lotGridSeams.map((s) => s.map(shift)),
    textLabels: doc.textLabels.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy })),
    scribbles: doc.scribbles.map((sc) => ({ ...sc, points: sc.points.map(shift) })),
  }
}

/** Pull the live (active-canvas) document out of the store state into a snapshot. */
function captureCanvasDoc(state: DrawingState): CanvasDoc {
  return {
    graph: state.graph,
    lockPolygons: state.lockPolygons,
    intentPins: state.intentPins,
    departments: state.departments,
    rooms: state.rooms,
    lotGridSeams: state.lotGridSeams,
    textLabels: state.textLabels,
    scribbles: state.scribbles,
    boundary: state.boundary,
    circulationPaths: state.circulationPaths,
    underlay: state.underlay,
    pageWidth: state.pageWidth,
    pageHeight: state.pageHeight,
    sheetName: state.sheetName,
    activeLayer: state.activeLayer,
    maxLayerReached: state.maxLayerReached,
    context: state.context,
    gridType: state.gridType,
    gridSpacing: state.gridSpacing,
    boundaryInfillOpacity: state.boundaryInfillOpacity,
    circulationWidth: state.circulationWidth,
    circulationMinorWidth: state.circulationMinorWidth,
    metersPerWorldUnit: state.metersPerWorldUnit,
    mapActive: state.mapActive,
    mapDim: state.mapDim,
    mapGeometry: state.mapGeometry,
  }
}

/** Load a document into the live top-level fields (rebuilding derived caches). */
function applyCanvasDoc(doc: CanvasDoc): Partial<DrawingState> {
  return {
    graph: doc.graph,
    spatialIndex: buildSnapIndex(doc.graph, snapExtras(doc)),
    lockPolygons: doc.lockPolygons,
    intentPins: doc.intentPins,
    departments: doc.departments,
    rooms: doc.rooms,
    lotGridSeams: doc.lotGridSeams,
    textLabels: doc.textLabels,
    scribbles: doc.scribbles,
    boundary: doc.boundary,
    circulationPaths: doc.circulationPaths,
    ...circMasks(doc.circulationPaths),
    underlay: doc.underlay,
    pageWidth: doc.pageWidth,
    pageHeight: doc.pageHeight,
    sheetName: doc.sheetName,
    // Per-board layer pipeline memory.
    activeLayer: doc.activeLayer,
    maxLayerReached: doc.maxLayerReached,
    context: doc.context,
    gridType: doc.gridType,
    gridSpacing: doc.gridSpacing,
    boundaryInfillOpacity: doc.boundaryInfillOpacity,
    circulationWidth: doc.circulationWidth,
    circulationMinorWidth: doc.circulationMinorWidth,
    metersPerWorldUnit: doc.metersPerWorldUnit,
    mapActive: doc.mapActive,
    mapDim: doc.mapDim,
    mapGeometry: doc.mapGeometry,
    // Transient interaction state never carries across a canvas switch.
    selectedStrokeIds: [],
    pendingPin: null,
    pendingDept: null,
    pendingText: null,
    liveScribble: null,
    activeSnapGuide: null,
    trackedPoints: [],
  }
}

/** The page rectangle (center + size, world units) of any canvas. */
export function canvasRect(
  state: DrawingState,
  id: string,
): { cx: number; cy: number; w: number; h: number } | null {
  const entry = state.canvases.find((c) => c.id === id)
  if (!entry) return null
  if (id === state.activeCanvasId) {
    return { cx: entry.origin.x, cy: entry.origin.y, w: state.pageWidth, h: state.pageHeight }
  }
  const doc = state.inactiveCanvasDocs[id]
  if (!doc) return null
  return { cx: entry.origin.x, cy: entry.origin.y, w: doc.pageWidth, h: doc.pageHeight }
}

/** World-space origin of the active board (center of its page). Central = (0,0). */
export function activeOrigin(state: DrawingState): { x: number; y: number } {
  return state.canvases.find((c) => c.id === state.activeCanvasId)?.origin ?? { x: 0, y: 0 }
}

/** Id of the canvas whose page rectangle contains the world point, or null. */
export function canvasAt(state: DrawingState, x: number, y: number): string | null {
  for (const entry of state.canvases) {
    const r = canvasRect(state, entry.id)
    if (!r) continue
    if (Math.abs(x - r.cx) <= r.w / 2 && Math.abs(y - r.cy) <= r.h / 2) return entry.id
  }
  return null
}

/**
 * The origin for a new canvas placed one slot from `from` in `direction`, pushed
 * further out along that axis until its (gutter-padded) page rectangle clears every
 * existing canvas — so spawning repeatedly in one direction lines them up in a row.
 */
function freeOriginInDirection(
  state: DrawingState,
  from: { x: number; y: number },
  direction: CardinalDirection,
  w: number,
  h: number,
): { x: number; y: number } {
  const ux = direction === 'E' ? 1 : direction === 'W' ? -1 : 0
  const uy = direction === 'N' ? 1 : direction === 'S' ? -1 : 0
  // Center-to-center step for the first slot: half of each page + the gutter.
  const baseStep = (ux !== 0 ? (state.pageWidth + w) / 2 : (state.pageHeight + h) / 2) + CANVAS_GAP
  const stepInc = (ux !== 0 ? w : h) + CANVAS_GAP

  const rects = state.canvases
    .map((c) => canvasRect(state, c.id))
    .filter((r): r is NonNullable<typeof r> => r != null)

  const overlaps = (cx: number, cy: number): boolean =>
    rects.some(
      (r) =>
        Math.abs(cx - r.cx) < (w + r.w) / 2 + CANVAS_GAP * 0.5 &&
        Math.abs(cy - r.cy) < (h + r.h) / 2 + CANVAS_GAP * 0.5,
    )

  let step = baseStep
  let cx = from.x + ux * step
  let cy = from.y + uy * step
  // Bounded search: never loop forever even with a pathological layout.
  for (let i = 0; i < 64 && overlaps(cx, cy); i++) {
    step += stepInc
    cx = from.x + ux * step
    cy = from.y + uy * step
  }
  return { x: cx, y: cy }
}

// Keep the spatial snap index in lockstep with the graph AND the boundary /
// circulation polylines (improvements C2).
//
// Position-only vertex moves (the drag hot path) are handled INCREMENTALLY inside
// setVertexPositions, which re-buckets just the moved vertices in place and leaves
// the strokes array reference untouched. Any action that changes topology — stroke
// commit, polyline finish, erase, lock/lasso segmentation, undo/redo, clear, or a
// boundary / circulation edit — produces a NEW array reference, so reference
// inequality is an O(1) signal that the edge set changed and the index must be
// rebuilt. This keeps one central seam without the O(N) rebuild firing on drags.
useDrawingStore.subscribe((state, prev) => {
  const topologyChanged = state.graph !== prev.graph && state.graph.strokes !== prev.graph.strokes
  const featuresChanged =
    state.boundary !== prev.boundary || state.circulationPaths !== prev.circulationPaths
  if (!topologyChanged && !featuresChanged) return
  useDrawingStore.setState({ spatialIndex: buildSnapIndex(state.graph, snapExtras(state)) })
})
