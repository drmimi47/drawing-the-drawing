import { INTENT_TYPES, type IntentPin, type IntentType } from '../types/geometry'
import { evaluatePinField } from './metaballField'
import { marchingSquares, type Ring } from './marchingSquares'

/**
 * Independent per-type intent isoline extraction (Cluster 3, Task 3.1).
 *
 * Because the intent fields are mathematically isolated, contours must be traced
 * one type at a time: the marching-squares engine runs separately over each
 * active type's own field, yielding closed boundary rings for Density, Pedestrian,
 * SQF, and Land use independently. These rings feed the Phase-2 serializer (so the
 * LLM sees where each intent zone begins/ends) and can be drawn as overlays.
 */

/** Iso-level for the field boundary. Matches the shader's VIS_THRESHOLD so the
 *  traced rings coincide with the visible edge of each colored field. */
export const INTENT_ISO_LEVEL = 0.15

/** Grid sampling resolution (world units). Smaller = smoother rings, more cost. */
const CONTOUR_CELL = 8

export interface IntentContour {
  type: IntentType
  /** Closed boundary rings of this type's field at INTENT_ISO_LEVEL. */
  rings: Ring[]
}

/**
 * Extract closed boundary rings for every intent type that has pins. Each type's
 * field is sampled over its own padded AABB (padding guarantees the border is
 * below the iso-level, so every ring closes).
 */
export function extractIntentContours(
  pins: IntentPin[],
  iso: number = INTENT_ISO_LEVEL,
  cellSize: number = CONTOUR_CELL,
): IntentContour[] {
  const out: IntentContour[] = []

  for (const type of INTENT_TYPES) {
    const typePins = pins.filter((p) => p.intentType === type && p.radius > 0)
    if (typePins.length === 0) continue

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of typePins) {
      if (p.x - p.radius < minX) minX = p.x - p.radius
      if (p.y - p.radius < minY) minY = p.y - p.radius
      if (p.x + p.radius > maxX) maxX = p.x + p.radius
      if (p.y + p.radius > maxY) maxY = p.y + p.radius
    }

    const pad = cellSize
    const bounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
    const field = (x: number, y: number) => evaluatePinField(x, y, type, typePins)
    const rings = marchingSquares(field, bounds, cellSize, iso).filter((r) => r.length >= 3)

    if (rings.length > 0) out.push({ type, rings })
  }

  return out
}
