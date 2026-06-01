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

/** A stroke: an ordered path through shared vertices, plus retained raw input. */
export interface Stroke {
  id: string
  color: string
  path: PathPoint[]
  raw?: RawSample[]
  // Reserved: curve?: 'line' | 'catmull' for per-stroke curve behavior.
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

/** Display label + field color per intent type. */
export const INTENT_META: Record<IntentType, { label: string; color: string }> = {
  DENSITY: { label: 'Density', color: '#8b5cf6' },
  PEDESTRIAN: { label: 'Pedestrian Flow', color: '#1f9d55' },
  SQF: { label: 'SQF Priority', color: '#e8852b' },
  LANDUSE: { label: 'Land Use', color: '#2f6fed' },
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
