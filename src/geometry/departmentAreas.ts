import { pointInPolygon } from './locks'
import { pointSegmentDistSq } from './graph'
import type { Boundary, CirculationPath, Department } from '../types/geometry'

/**
 * Department area diagnostics (restructure_v2 Stage 3.5).
 *
 * Rasterizes each department's MAX-FEASIBLE footprint on a coarse grid that mirrors the
 * field shader: a cell belongs to a department when that department's Wyvill potential
 * exceeds FIELD_THRESHOLD there, the cell is inside the hard domain (boundary ∩ ¬main
 * corridors), and the department's center has line-of-sight to the cell (not across a
 * main artery). From that we report two areas per department:
 *
 *   • Core SQF — cells this department owns EXCLUSIVELY (no other department's field
 *     also clears the threshold there).
 *   • Max Potential SQF — the department's whole footprint, INCLUDING the negotiable
 *     overlaps it shares with neighbors (3.5.2). Max − Core = its negotiable area.
 *
 * Recomputed only when boundary / circulation / departments / scale change (the panel
 * memoizes it), not per frame.
 */

const SQM_TO_SQFT = 10.7639
const GRID = 160 // cells along the longer axis (resolution/perf trade-off)
const FIELD_THRESHOLD = 0.1 // low-threshold contour (3.5.1)

export interface DeptAreas {
  /** Exclusive footprint area (no overlap with other departments). */
  coreSqf: number
  /** Full footprint area, inclusive of negotiable overlaps. */
  maxSqf: number
}

export interface DepartmentDiagnostics {
  areas: Record<string, DeptAreas>
  /** Fraction of the hard domain (lot ∩ ¬main corridors) where at least one department
   *  field clears the threshold — i.e. how much of the lot infill is covered by gradients.
   *  1 = no white left. Drives the Rooms-layer unlock gate. */
  coverage: number
  /** Number of grid cells inside the hard domain (0 ⇒ nothing to cover). */
  insideCells: number
}

export function computeDepartmentAreas(
  boundary: Boundary | null,
  mainPaths: CirculationPath[],
  departments: Department[],
  metersPerWorldUnit: number | null,
): DepartmentDiagnostics {
  const out: Record<string, DeptAreas> = {}
  for (const d of departments) out[d.id] = { coreSqf: 0, maxSqf: 0 }
  if (!boundary || boundary.isClosed === false || boundary.ring.length < 3 || departments.length === 0) {
    return { areas: out, coverage: 0, insideCells: 0 }
  }
  const ring = boundary.ring

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of ring) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const worldW = maxX - minX
  const worldH = maxY - minY
  if (worldW <= 0 || worldH <= 0) return { areas: out, coverage: 0, insideCells: 0 }

  const res = Math.max(worldW, worldH) / GRID
  const width = Math.max(2, Math.ceil(worldW / res))
  const height = Math.max(2, Math.ceil(worldH / res))

  const segs: { a: { x: number; y: number }; b: { x: number; y: number }; hw2: number }[] = []
  for (const path of mainPaths) {
    const c = path.centerline
    const hw2 = (path.width / 2) * (path.width / 2)
    for (let i = 0; i < c.length - 1; i++) segs.push({ a: c[i], b: c[i + 1], hw2 })
  }
  const useLos = segs.length > 0

  // Hard-domain grid: 1 = inside lot and off every main corridor.
  const inside = new Uint8Array(width * height)
  let insideCount = 0
  for (let j = 0; j < height; j++) {
    const wy = minY + ((j + 0.5) / height) * worldH
    for (let i = 0; i < width; i++) {
      const wx = minX + ((i + 0.5) / width) * worldW
      let on = pointInPolygon(wx, wy, ring)
      if (on) {
        for (const s of segs) {
          if (pointSegmentDistSq(wx, wy, s.a, s.b) <= s.hw2) {
            on = false
            break
          }
        }
      }
      if (on) {
        inside[j * width + i] = 1
        insideCount++
      }
    }
  }

  // Line-of-sight in grid space: blocked if the segment leaves the hard domain.
  const losBlocked = (gx0: number, gy0: number, gx1: number, gy1: number): boolean => {
    const dx = gx1 - gx0
    const dy = gy1 - gy0
    const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy)))
    for (let k = 1; k < steps; k++) {
      const t = k / steps
      const gx = Math.floor(gx0 + dx * t)
      const gy = Math.floor(gy0 + dy * t)
      if (gx < 0 || gy < 0 || gx >= width || gy >= height) return true
      if (!inside[gy * width + gx]) return true
    }
    return false
  }

  // Department centers in grid coordinates.
  const centers = departments.map((d) => ({
    gx: ((d.x - minX) / worldW) * width,
    gy: ((d.y - minY) / worldH) * height,
    r2: d.radius * d.radius,
    x: d.x,
    y: d.y,
  }))

  const cellAreaWorld = (worldW / width) * (worldH / height)
  const toSqft =
    metersPerWorldUnit != null && metersPerWorldUnit > 0
      ? metersPerWorldUnit * metersPerWorldUnit * SQM_TO_SQFT
      : 1
  const cellSqf = cellAreaWorld * toSqft

  const member: boolean[] = new Array(departments.length).fill(false)
  let coveredCount = 0
  for (let j = 0; j < height; j++) {
    const wy = minY + ((j + 0.5) / height) * worldH
    for (let i = 0; i < width; i++) {
      if (!inside[j * width + i]) continue
      const wx = minX + ((i + 0.5) / width) * worldW
      let count = 0
      let lastIdx = -1
      for (let di = 0; di < centers.length; di++) {
        const c = centers[di]
        const ddx = wx - c.x
        const ddy = wy - c.y
        const d2 = ddx * ddx + ddy * ddy
        let m = false
        if (d2 < c.r2) {
          const f = 1 - d2 / c.r2
          if (f * f * f > FIELD_THRESHOLD && !(useLos && losBlocked(i + 0.5, j + 0.5, c.gx, c.gy))) {
            m = true
          }
        }
        member[di] = m
        if (m) {
          count++
          lastIdx = di
        }
      }
      if (count === 0) continue
      coveredCount++
      if (count === 1) {
        out[departments[lastIdx].id].coreSqf += cellSqf
        out[departments[lastIdx].id].maxSqf += cellSqf
      } else {
        for (let di = 0; di < centers.length; di++) {
          if (member[di]) out[departments[di].id].maxSqf += cellSqf
        }
      }
    }
  }

  return {
    areas: out,
    coverage: insideCount > 0 ? coveredCount / insideCount : 0,
    insideCells: insideCount,
  }
}
