/**
 * Geometry data model (Cluster D).
 *
 * Layered, with the planar graph (Tier 2) as the editable source of truth. See
 * plan_final.txt "CORE DATA MODEL" for the rationale (segment graph over a
 * Bezier source-of-truth, so mutations and AI edits stay lossless).
 */

/** Tier 1 — a retained raw pointer sample. */
export interface RawSample {
  x: number
  y: number
  pressure: number
  /** Timestamp (ms) relative to stroke start. */
  t: number
}

/** A resolved centerline point used for clipping and rendering. `w` is half-width. */
export interface SamplePoint {
  x: number
  y: number
  w: number
}

/** Tier 2 — a graph vertex. Position is shared; intersections reference one vertex. */
export interface Vertex {
  id: string
  x: number
  y: number
  // Reserved for future smooth/curve editing:
  // tangentIn?: { x: number; y: number }
  // tangentOut?: { x: number; y: number }
}

/** One step along a stroke's path: which vertex, and the half-width there. */
export interface PathPoint {
  v: string
  w: number
}

/**
 * Drafting line style (Cluster 3, improvements C3). Hierarchical line formatting
 * for professional markup — heavy solid for parcels, dashed for setbacks, etc.
 */
export type LineStyle = 'solid' | 'dashed' | 'long-dash' | 'dotted'

/** Lineweight presets in world units (full width). 1 world unit = 1px @ zoom 1. */
export const LINEWEIGHTS: { label: string; width: number }[] = [
  { label: 'Fine', width: 1 },
  { label: 'Standard', width: 2 },
  { label: 'Bold', width: 4 },
  { label: 'Thick', width: 6 },
]

/** A stroke: an ordered path through shared vertices, plus retained raw input. */
export interface Stroke {
  id: string
  color: string
  path: PathPoint[]
  raw?: RawSample[]
  /** Polyline strokes render with straight segments (no Catmull-Rom smoothing). */
  straight?: boolean
  /**
   * Drafting attributes (improvements C3). Styling lives on the stroke (the
   * persistent drawable unit) rather than on derived Edges, which are regenerated
   * on every deriveEdges() call and so cannot retain metadata.
   */
  /** Full stroke width in world units; falls back to 2× path half-width if absent. */
  strokeWidth?: number
  /** Line style; treated as 'solid' if absent (back-compat with older strokes). */
  lineStyle?: LineStyle
}

/** A free-floating text annotation placed on the canvas (world-anchored). */
export interface TextLabel {
  id: string
  x: number
  y: number
  text: string
  color: string
  /** Font size in world units (scales with zoom). */
  size: number
}

/**
 * A freehand scribble — a pure raster-style annotation. It is deliberately NOT
 * part of the planar graph (it never affects boundaries, circulation, snapping, or
 * generation); it's just a quick mark the designer paints on top. Points are an
 * open world-space polyline; `width` is the pen thickness in world units. The
 * eraser removes a whole scribble at once (Figma-style), not segment-by-segment.
 */
export interface ScribbleStroke {
  id: string
  color: string
  /** Pen thickness in world units (scales with zoom, like the old vector stroke). */
  width: number
  points: { x: number; y: number }[]
}

/** A derived edge (segment between two consecutive path vertices). */
export interface Edge {
  id: string
  strokeId: string
  v0: string
  v1: string
}

/** The planar graph: the editable source of truth. */
export interface Graph {
  vertices: Record<string, Vertex>
  strokes: Stroke[]
}

/**
 * A geometric lock region (Cluster H). Influence is an interior distance field:
 * hard-locked (1.0) deep in the core, fading to 0 at the boundary across
 * `featherRadius` — a soft "negotiation" boundary for normalize/generate.
 */
export interface LockPolygon {
  id: string
  points: { x: number; y: number }[]
  featherRadius: number
}

/** Programmatic intent categories an Intent Pin can carry (Rooms-layer metaball fields).
 *  Two for now: DENSITY (tighter/cellular) and OPENNESS (looser/open-plan). */
export type IntentType = 'DENSITY' | 'OPENNESS'

/** Canonical ordering of all intent types (for field/mix iteration). */
export const INTENT_TYPES: IntentType[] = ['DENSITY', 'OPENNESS']

/** Display label + field color per intent type. */
export const INTENT_META: Record<IntentType, { label: string; color: string }> = {
  DENSITY: { label: 'Density', color: '#8b5cf6' }, // purple
  OPENNESS: { label: 'Openness', color: '#14b8a6' }, // teal
}

/**
 * An intent pin (Cluster H). A spatial prompt that does NOT freeze geometry; it
 * emits a soft influence field used (in Phase 2) to steer generation locally.
 */
export interface IntentPin {
  id: string
  x: number
  y: number
  radius: number
  intentType: IntentType
}

/** Common building programs a department zone can be (office-leaning). Picked from a
 *  popup when placing a department, like intent pins pick an intent type. MECHANICAL and
 *  CORE are the building's services/shafts — they ALWAYS render black / grey. */
export type DepartmentType =
  | 'OPEN_OFFICE'
  | 'PRIVATE_OFFICE'
  | 'CONFERENCE'
  | 'RECEPTION'
  | 'BREAK'
  | 'COLLABORATION'
  | 'RESTROOM'
  | 'STORAGE'
  | 'CORE'
  | 'MECHANICAL'

/** Canonical ordering (drives the placement popup). */
export const DEPARTMENT_TYPES: DepartmentType[] = [
  'OPEN_OFFICE',
  'PRIVATE_OFFICE',
  'CONFERENCE',
  'RECEPTION',
  'BREAK',
  'COLLABORATION',
  'RESTROOM',
  'STORAGE',
  'CORE',
  'MECHANICAL',
]

/** Display label + field color + default grain per department type.
 *  grain ∈ [0,1]: 0 = most open (few large rooms / open-plan), 1 = most cellular (many
 *  small rooms). The placement seeds a department's grain from its type; the user then
 *  nudges it (Stage 4). CORE / MECHANICAL are monolithic services → grain 0. */
export const DEPARTMENT_META: Record<DepartmentType, { label: string; color: string; defaultGrain: number }> = {
  OPEN_OFFICE: { label: 'Open Office', color: '#2f6fed', defaultGrain: 0.15 },
  PRIVATE_OFFICE: { label: 'Private Offices', color: '#8b5cf6', defaultGrain: 0.85 },
  CONFERENCE: { label: 'Conference / Meeting', color: '#e8852b', defaultGrain: 0.35 },
  RECEPTION: { label: 'Reception / Lobby', color: '#e0457b', defaultGrain: 0.2 },
  BREAK: { label: 'Break Room / Pantry', color: '#1f9d55', defaultGrain: 0.25 },
  COLLABORATION: { label: 'Collaboration / Lounge', color: '#14b8a6', defaultGrain: 0.2 },
  RESTROOM: { label: 'Restrooms', color: '#0ea5e9', defaultGrain: 0.7 },
  STORAGE: { label: 'Storage / IT', color: '#b45309', defaultGrain: 0.6 },
  CORE: { label: 'Core', color: '#9ca3af', defaultGrain: 0 }, // always grey, monolithic
  MECHANICAL: { label: 'Mechanical', color: '#111111', defaultGrain: 0 }, // always black, monolithic
}

/** Neutral fallback grain for departments with no type (placed before types existed). */
export const DEFAULT_GRAIN = 0.4

/** Department types whose field color is fixed (the panel can't recolor them). */
export const FIXED_COLOR_DEPT_TYPES = new Set<DepartmentType>(['CORE', 'MECHANICAL'])

/**
 * A department zone (restructure_v1 Stage 3). Like an intent pin it's a soft
 * BLENDING field (center + radius, Wyvill falloff), but it carries program metadata
 * (type, name, target area) and its own color, and its field is HARD-MASKED to the lot
 * boundary minus the circulation network — so the gradient morphs to stay inside the
 * lot and never crosses a corridor. Department fields still blend/overlap each other
 * freely (no inter-department exclusion — restructure_v1 CONFLICTS #11).
 */
export interface Department {
  id: string
  name: string
  x: number
  y: number
  radius: number
  color: string
  /** Program type chosen at placement (drives default name + color); optional for
   *  departments created before types existed. */
  deptType?: DepartmentType
  /** Optional target floor area (ft², or world units² with no map scale). */
  targetSqf?: number
  /** Parametric room count N for this department (Stage 4); undefined ⇒ no rooms yet.
   *  Acts as a manual override; when `grain` is set the count is derived from grain. */
  roomCount?: number
  /** Subdivision grain ∈ [0,1] (Stage 4): 0 = open-plan (few large rooms), 1 = cellular
   *  (many small rooms). The primary room control — the engine derives the effective room
   *  count from the department's footprint area and this grain. */
  grain?: number
}

/**
 * A room (restructure_v2 Stage 4): a gap-free sub-polygon of its parent department,
 * produced by the parametric slicing engine (equal-area strips, minor corridors carved
 * out). `isLocked` rooms are immune to parametric regeneration (4.5.2).
 */
export interface Room {
  roomId: string
  parentDeptId: string
  /** Closed polygon ring in world coordinates (first point not repeated). */
  polygon: { x: number; y: number }[]
  /** Floor area (ft², or world units² with no map scale). */
  areaSqf: number
  isLocked: boolean
  /** Optional user-given name (Program Sheet); transient — cleared on regeneration. */
  name?: string
}

/** Rotating palette for new department zones (distinct, legible hues). */
export const DEPARTMENT_PALETTE: string[] = [
  '#2f6fed', // blue
  '#e8852b', // orange
  '#1f9d55', // green
  '#8b5cf6', // violet
  '#e0457b', // pink
  '#0ea5e9', // sky
  '#b45309', // amber-brown
  '#14b8a6', // teal
]

export const emptyGraph = (): Graph => ({ vertices: {}, strokes: [] })

/**
 * Lot boundary (Gradia restructure — Stage 1). A first-class, closed ring that is
 * the master working area ("a canvas within the canvas"). `targetSqf` drives the
 * advisory delta readout (never an auto-transform — Stage 1.3).
 */
export interface Boundary {
  /** Ring in world coordinates (first point not repeated at the end). When
   *  `isClosed` is false this is an OPEN chain (a segment was erased) and the lot
   *  must be re-closed before downstream layers unlock. */
  ring: { x: number; y: number }[]
  /** Whether the ring forms a complete closed loop. Absent ⇒ treated as closed
   *  (back-compat with boundaries committed before the segment eraser existed). */
  isClosed?: boolean
  /** Designer's desired gross area, in the active unit; optional. */
  targetSqf?: number
}

/**
 * A circulation (hallway) centerline (Gradia restructure — Stage 2). The open
 * polyline is offset to `width` (world units) into a corridor band; the union of
 * all bands forms the keep-out mask that repels department fields downstream.
 */
/** Circulation hierarchy (restructure_v2 Stage 2): primary structural spine vs. smaller
 *  localized connectors. MAIN paths are hard barriers to department fields; MINOR paths
 *  are permeable (fields bleed across them). */
export type CirculationTier = 'MAIN' | 'MINOR'

export interface CirculationPath {
  id: string
  /** Open polyline centerline in world coordinates. */
  centerline: { x: number; y: number }[]
  /** Full corridor width in world units. */
  width: number
  /** Pathway hierarchy. Absent ⇒ treated as MAIN (back-compat with paths drawn
   *  before the main/secondary distinction existed). */
  tier?: CirculationTier
}

/**
 * Active snap guide emitted by the polyline snapping pipeline (Step 1).
 *
 * Coordinates are stored as [x, y] tuples in world space. The overlay renderer
 * reads this to draw the appropriate visual indicator (dashed line, glyph, label).
 */
export type SnapGuideType =
  | 'endpoint'
  | 'midpoint'
  | 'intersection'
  | 'perpendicular'
  | 'parallel'
  | 'extension'
  | 'tracking'
  | 'edge'

export interface SnapGuide {
  type: SnapGuideType
  /** World-space origin of the guide line (e.g. the last placed polyline vertex). */
  fromPoint: [number, number]
  /** Snapped cursor coordinate — the destination the guide points to. */
  toPoint: [number, number]
  /** Edge id that triggered the snap (perpendicular / parallel). */
  sourceEdgeId?: string
  /** Vertex id that triggered the snap (endpoint). */
  sourceVertexId?: string
}
