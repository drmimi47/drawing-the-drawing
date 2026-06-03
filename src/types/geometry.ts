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

/** Programmatic intent categories an Intent Pin can carry (Cluster H). */
export type IntentType = 'DENSITY' | 'PEDESTRIAN' | 'SQF' | 'LANDUSE'

/** Canonical ordering of all intent types (for field/mix iteration). */
export const INTENT_TYPES: IntentType[] = ['DENSITY', 'PEDESTRIAN', 'SQF', 'LANDUSE']

/** Display label + field color per intent type. */
export const INTENT_META: Record<IntentType, { label: string; color: string }> = {
  DENSITY: { label: 'Density', color: '#8b5cf6' },
  PEDESTRIAN: { label: 'Pedestrian flow', color: '#1f9d55' },
  SQF: { label: 'SQF priority', color: '#e8852b' },
  LANDUSE: { label: 'Land use', color: '#2f6fed' },
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

export const emptyGraph = (): Graph => ({ vertices: {}, strokes: [] })

/**
 * Lot boundary (Bloom restructure — Stage 1). A first-class, closed ring that is
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
 * A circulation (hallway) centerline (Bloom restructure — Stage 2). The open
 * polyline is offset to `width` (world units) into a corridor band; the union of
 * all bands forms the keep-out mask that repels department fields downstream.
 */
export interface CirculationPath {
  id: string
  /** Open polyline centerline in world coordinates. */
  centerline: { x: number; y: number }[]
  /** Full corridor width in world units. */
  width: number
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
