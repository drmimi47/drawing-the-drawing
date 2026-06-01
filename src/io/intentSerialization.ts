import type { Graph, IntentPin, IntentType } from '../types/geometry'
import { getIntentConcentration } from '../utils/metaballField'
import { extractIntentContours } from '../utils/intentContours'

/**
 * Multi-channel intent serialization (Cluster 3, Task 3.2).
 *
 * Prepares the payload the Phase-2 LLM (Generate) will consume. The defining idea:
 * never flatten a location to a single intent type. Every serialized node/region
 * carries an `intentMix` — the exact local concentration of all four planner
 * intents (summing to 1 wherever any field is present) — so Claude can reason
 * about where intents blend or conflict, not just which one "wins".
 *
 * Two cross-sections are emitted:
 *   vertices — every PSLG vertex, tagged with the intent mix sampled at its point
 *   regions  — each type's closed field boundary ring (from marching squares),
 *              tagged with the mix sampled at the ring's centroid
 *
 * This is pure data prep; it does not call any model. Phase 2 wires it to
 * api/generate.ts.
 */

/** Local intent concentration as a flat, LLM-friendly object (keys sum to ≤ 1). */
export interface IntentMix {
  density: number
  pedestrian: number
  sqf: number
  landuse: number
}

export interface SerializedVertex {
  id: string
  x: number
  y: number
  intentMix: IntentMix
}

export interface SerializedRegion {
  id: string
  /** Dominant intent type whose field boundary defines this region. */
  type: keyof IntentMix
  /** Closed boundary ring (world coordinates; closure implied). */
  positions: { x: number; y: number }[]
  /** Intent mix sampled at the region centroid. */
  intentMix: IntentMix
}

export interface IntentSerialization {
  vertices: SerializedVertex[]
  regions: SerializedRegion[]
}

/** Map the internal IntentType enum to the serialized lowercase key. */
const TYPE_KEY: Record<IntentType, keyof IntentMix> = {
  DENSITY: 'density',
  PEDESTRIAN: 'pedestrian',
  SQF: 'sqf',
  LANDUSE: 'landuse',
}

const ROUND = (n: number) => Math.round(n * 1000) / 1000

/** Sample the normalized intent mix at a point as a flat lowercase object. */
function mixAt(x: number, y: number, pins: IntentPin[]): IntentMix {
  const { mix } = getIntentConcentration(x, y, pins)
  return {
    density: ROUND(mix.DENSITY),
    pedestrian: ROUND(mix.PEDESTRIAN),
    sqf: ROUND(mix.SQF),
    landuse: ROUND(mix.LANDUSE),
  }
}

/** Centroid (vertex average) of a ring. */
function centroid(ring: { x: number; y: number }[]): { x: number; y: number } {
  let sx = 0
  let sy = 0
  for (const p of ring) {
    sx += p.x
    sy += p.y
  }
  return { x: sx / ring.length, y: sy / ring.length }
}

/**
 * Build the multi-channel intent payload from the current graph + pins. Pass the
 * graph's vertices and the live intent pins; returns vertices and field-boundary
 * regions, each annotated with its local intent mix.
 */
export function serializeIntent(graph: Graph, pins: IntentPin[]): IntentSerialization {
  const vertices: SerializedVertex[] = []
  for (const id in graph.vertices) {
    const v = graph.vertices[id]
    vertices.push({ id, x: v.x, y: v.y, intentMix: mixAt(v.x, v.y, pins) })
  }

  const regions: SerializedRegion[] = []
  for (const contour of extractIntentContours(pins)) {
    contour.rings.forEach((ring, i) => {
      const c = centroid(ring)
      regions.push({
        id: `${TYPE_KEY[contour.type]}-region-${i}`,
        type: TYPE_KEY[contour.type],
        positions: ring.map((p) => ({ x: p.x, y: p.y })),
        intentMix: mixAt(c.x, c.y, pins),
      })
    })
  }

  return { vertices, regions }
}
