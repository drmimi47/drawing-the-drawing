import { INTENT_TYPES, type IntentPin, type IntentType } from '../types/geometry'

/**
 * Isolated multi-field metaball mathematics (Cluster 1).
 *
 * Intent pins emit cumulative 2D scalar fields, but attraction is strictly
 * ISOLATED per intent type: a Density pin never adds potential to the Pedestrian
 * field, and so on. Where fields of different types overlap we compute the exact
 * percentage composition of local planner intent — the "intent mix" — rather than
 * letting one type overwrite another.
 *
 * These are pure functions over plain data so they can drive every consumer
 * uniformly: the hover HUD, the WebGL concentration shader (Cluster 2), the
 * marching-squares contour extractor, and the Phase-2 LLM serializer (Cluster 3).
 */

/**
 * Cumulative field potential of a SINGLE intent type at a point.
 *
 * Only pins of the targeted `type` contribute (isolation). Each contributing pin
 * uses the Wyvill "soft object" falloff — smooth, finite-support, and exactly
 * zero at the pin radius:
 *
 *   potential = (1 - d² / r²)³   for d < r,   else 0
 *
 * (d² / r² is used directly; squaring the Euclidean distance avoids a needless
 * sqrt and is algebraically identical.) Contributions are summed, so clustered
 * pins of the same type reinforce into a higher combined potential.
 */
export function evaluatePinField(x: number, y: number, type: IntentType, pins: IntentPin[]): number {
  let total = 0
  for (const pin of pins) {
    if (pin.intentType !== type || pin.radius <= 0) continue
    const dx = x - pin.x
    const dy = y - pin.y
    const d2 = dx * dx + dy * dy
    const r2 = pin.radius * pin.radius
    if (d2 >= r2) continue
    const falloff = 1 - d2 / r2
    total += falloff * falloff * falloff
  }
  return total
}

/** Local intent composition at a point: absolute fields + relative percentages. */
export interface IntentConcentration {
  /** Summed absolute field potential across all types (drives opacity/strength). */
  total: number
  /** Per-type absolute field potential. */
  fields: Record<IntentType, number>
  /**
   * Per-type relative concentration in 0..1. Sums to exactly 1 when `total > 0`
   * (i.e. 100% planner intent split across the active types); all zero otherwise.
   */
  mix: Record<IntentType, number>
}

/**
 * Multi-criteria intent mix at a point.
 *
 * Evaluates each type's isolated field independently, sums them, then expresses
 * each type as a fraction of that total. Because the parts are divided by their
 * own sum, the mix is normalized — the active types' concentrations always add up
 * to 1 (100%) wherever any field is present.
 */
export function getIntentConcentration(x: number, y: number, pins: IntentPin[]): IntentConcentration {
  const fields = {} as Record<IntentType, number>
  let total = 0
  for (const type of INTENT_TYPES) {
    const f = evaluatePinField(x, y, type, pins)
    fields[type] = f
    total += f
  }

  const mix = {} as Record<IntentType, number>
  for (const type of INTENT_TYPES) {
    mix[type] = total > 0 ? fields[type] / total : 0
  }

  return { total, fields, mix }
}

/**
 * Region-averaged intent concentration over an axis-aligned cell.
 *
 * A single point sample can misrepresent a cell that straddles a field edge or a
 * blend boundary. This supersamples the cell on an N×N sub-grid and AVERAGES the
 * absolute fields (not the ratios — averaging ratios would be wrong), then derives
 * the mix from those averaged fields. The result is the true area-weighted
 * composition of the region: exactly the concentration an LLM would read when
 * "pulling from" that cell. `total` is on the same 0..1+ scale as a point sample.
 */
export function getRegionConcentration(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  pins: IntentPin[],
  samples = 3,
): IntentConcentration {
  const n = Math.max(1, samples)
  const fields = { DENSITY: 0, PEDESTRIAN: 0, SQF: 0, LANDUSE: 0 } as Record<IntentType, number>

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = minX + ((i + 0.5) / n) * (maxX - minX)
      const y = minY + ((j + 0.5) / n) * (maxY - minY)
      for (const type of INTENT_TYPES) fields[type] += evaluatePinField(x, y, type, pins)
    }
  }

  const count = n * n
  let total = 0
  for (const type of INTENT_TYPES) {
    fields[type] /= count
    total += fields[type]
  }

  const mix = {} as Record<IntentType, number>
  for (const type of INTENT_TYPES) {
    mix[type] = total > 0 ? fields[type] / total : 0
  }

  return { total, fields, mix }
}
