import * as turf from '@turf/turf'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { polygonAreaWorld, worldAreaToSqft } from './area'
import { centerlineToBandRing } from './corridor'
import type { Boundary, CirculationPath, Room } from '../types/geometry'

/**
 * Project Dashboard metrics (document_int.txt §3 TAB 1) — the DOWNSTREAM binding: macro
 * efficiency figures computed live from the canvas (boundary + circulation + rooms). Pure and
 * memoizable; the grid just renders the result.
 */

type Pt = { x: number; y: number }
type PolyFeature = Feature<Polygon | MultiPolygon>

export interface ProgramMetrics {
  /** Total lot boundary area. */
  grossSite: number
  /** Main + minor corridor zones, clipped to the lot. */
  grossCirculation: number
  /** Sum of all room blocks. */
  netAssignable: number
  /** netAssignable / grossSite (0..1). */
  netToGross: number
  unit: 'ft²' | 'units²'
}

function toFeat(ring: Pt[]): Feature<Polygon> {
  const c = ring.map((p) => [p.x, p.y])
  c.push([ring[0].x, ring[0].y])
  return turf.polygon([c])
}

function tryUnion(a: PolyFeature, b: PolyFeature): PolyFeature {
  try {
    return (turf.union(turf.featureCollection([a, b])) as PolyFeature | null) ?? a
  } catch {
    return a
  }
}

function tryIntersect(a: PolyFeature, b: PolyFeature): PolyFeature | null {
  try {
    return turf.intersect(turf.featureCollection([a, b])) as PolyFeature | null
  } catch {
    return null
  }
}

/** World-unit area of a (multi)polygon feature, subtracting holes. */
function featureWorldArea(f: PolyFeature | null): number {
  if (!f) return 0
  const g = f.geometry
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  let area = 0
  for (const poly of polys) {
    poly.forEach((ringCoords, i) => {
      const pts = ringCoords.map(([x, y]) => ({ x, y }))
      const a = polygonAreaWorld(pts)
      area += i === 0 ? a : -a // first ring outer, rest holes
    })
  }
  return area
}

export function computeProgramMetrics(
  boundary: Boundary | null,
  circulationPaths: CirculationPath[],
  rooms: Room[],
  mpu: number | null,
): ProgramMetrics {
  const hasScale = mpu != null && mpu > 0
  const conv = (w: number) => (hasScale ? worldAreaToSqft(w, mpu as number) : w)

  const grossSiteW = boundary && boundary.ring.length >= 3 ? polygonAreaWorld(boundary.ring) : 0

  // Circulation = union of all corridor bands, clipped to the lot (so extensions past the
  // boundary and band overlaps aren't double-counted).
  let circW = 0
  if (grossSiteW > 0 && circulationPaths.length > 0) {
    const lot = toFeat(boundary!.ring) as PolyFeature
    let bands: PolyFeature | null = null
    for (const p of circulationPaths) {
      const band = centerlineToBandRing(p.centerline, p.width)
      if (band.length < 3) continue
      const bf = toFeat(band) as PolyFeature
      bands = bands ? tryUnion(bands, bf) : bf
    }
    if (bands) circW = featureWorldArea(tryIntersect(bands, lot))
  }

  const netW = rooms.reduce((s, r) => s + (r.polygon.length >= 3 ? polygonAreaWorld(r.polygon) : 0), 0)

  return {
    grossSite: conv(grossSiteW),
    grossCirculation: conv(circW),
    netAssignable: conv(netW),
    netToGross: grossSiteW > 0 ? netW / grossSiteW : 0,
    unit: hasScale ? 'ft²' : 'units²',
  }
}
