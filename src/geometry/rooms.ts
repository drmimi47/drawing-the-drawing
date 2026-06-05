import * as turf from '@turf/turf'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { polygonAreaWorld, worldAreaToSqft, sqftToWorldArea } from './area'
import { centerlineToBandRing } from './corridor'
import { pointSegmentDistSq } from './graph'
import { dominantLotOrientation, lotGridRegions } from './lotGrid'
import type { Boundary, CirculationPath, Department, Room } from '../types/geometry'

/**
 * Parametric room slicing engine (restructure_v2 Stage 4) — GRID-ALIGNED / ORTHOGONAL.
 *
 * Cuts are made in the LOT'S OWN ORIENTED FRAME (the dominant edge-grid direction from
 * lotGrid.ts), not world X/Y — so on a rotated or angled lot the rooms run true to the
 * walls (diagonal in world space) while remaining 90° to the lot. Cut positions snap to
 * the structural grid module, so room/department seams land on the lot grid.
 *
 * Hard structural rules:
 *   • Every seam/wall is a straight cut along one of the two grid axes (no arbitrary chords).
 *   • Cut positions snap to the structural grid (clean, aligned, stepped seams).
 *   • Aspect gatekeeper: cuts bisect the longer side; a hard minimum width stops any split
 *     that would yield a sliver (N is a target — fewer, fuller rooms beat slivers).
 *
 * Pipeline: PASS 1 lot ∖ MAIN corridors → pieces; each department binds to its piece, then
 * the piece is filled by a grid-aligned guillotine among its departments (corridor-fronting
 * when a main hall is near). PASS 2 each cell → ~N equal-area rooms. PASS 3 carve MINOR
 * corridors. PASS 4 absorb leftover slivers into neighbors.
 */

type Pt = { x: number; y: number }
type PolyFeature = Feature<Polygon | MultiPolygon>
/** A grid frame: two perpendicular cut axes (dirA/dirB) and the lattice anchor (phase). */
interface Frame {
  dirA: Pt
  dirB: Pt
  anchor: Pt
}

const MIN_ROOM_WORLD_AREA = 9
const M_TO_FT = 3.28084
const MIN_ROOM_FT = 8
/** Upper bound on rooms derived from grain — keeps a huge open department from exploding. */
const GRAIN_ROOM_CAP = 48

/**
 * Map a department's grain ∈ [0,1] to a TARGET average room area (world units²). grain 0 =
 * open-plan (large target → few/one room), grain 1 = cellular (small target → many rooms).
 * Interpolates geometrically between an "open" and a "cellular" target so the slider feels
 * even. Uses real ft² targets when a map scale exists, else ties the targets to the grid module.
 */
function grainToTargetArea(grain: number, mpu: number | null, grid: number): number {
  const g = Math.min(1, Math.max(0, grain))
  if (mpu != null && mpu > 0) {
    const openFt = 2500
    const cellFt = 120
    return sqftToWorldArea(openFt * Math.pow(cellFt / openFt, g), mpu)
  }
  const openW = (16 * grid) * (16 * grid)
  const cellW = (3 * grid) * (3 * grid)
  return openW * Math.pow(cellW / openW, g)
}

/** Effective room count for a department: grain-derived from the cell area when grain is set,
 *  else the manual roomCount (or 0). */
function effectiveCount(dept: Department, cellArea: number, mpu: number | null, grid: number): number {
  if (dept.grain != null) {
    const target = grainToTargetArea(dept.grain, mpu, grid)
    return Math.max(1, Math.min(GRAIN_ROOM_CAP, Math.round(cellArea / Math.max(1, target))))
  }
  return dept.roomCount ?? 0
}

let roomSeq = 0

function toFeature(ring: Pt[]): Feature<Polygon> {
  const coords = ring.map((p) => [p.x, p.y])
  coords.push([ring[0].x, ring[0].y])
  return turf.polygon([coords])
}

function intersect(a: PolyFeature, b: PolyFeature): PolyFeature | null {
  try {
    return turf.intersect(turf.featureCollection([a, b])) as PolyFeature | null
  } catch {
    return null
  }
}

function difference(a: PolyFeature, b: PolyFeature): PolyFeature | null {
  try {
    return (turf.difference(turf.featureCollection([a, b])) as PolyFeature | null) ?? null
  } catch {
    return a
  }
}

/** turf.intersect, but retried with cleaned coordinates — guillotine slabs can leave duplicate
 *  / collinear vertices that make the first boolean op return null, which would silently drop a
 *  grid region from a department that straddles a seam. */
function robustIntersect(a: PolyFeature, b: PolyFeature): PolyFeature | null {
  const direct = intersect(a, b)
  if (direct) return direct
  try {
    const ca = turf.cleanCoords(a) as PolyFeature
    const cb = turf.cleanCoords(b) as PolyFeature
    return turf.intersect(turf.featureCollection([ca, cb])) as PolyFeature | null
  } catch {
    return null
  }
}

/** Whether (x,y) lies inside a region feature (used to give leftover area its own orientation). */
function pointInFeature(f: PolyFeature, x: number, y: number): boolean {
  try {
    return turf.booleanPointInPolygon(turf.point([x, y]), f)
  } catch {
    return false
  }
}

function ringToPts(coords: number[][]): Pt[] {
  const pts = coords.map(([x, y]) => ({ x, y }))
  if (pts.length > 1) {
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (a.x === b.x && a.y === b.y) pts.pop()
  }
  return pts
}

function outerRings(f: PolyFeature | null): Pt[][] {
  if (!f) return []
  const g = f.geometry
  if (g.type === 'Polygon') return [ringToPts(g.coordinates[0])]
  if (g.type === 'MultiPolygon') return g.coordinates.map((poly) => ringToPts(poly[0]))
  return []
}

/** Gap-safe cleanup: drop duplicate + collinear vertices (no coordinate movement). */
function simplifyRing(ring: Pt[]): Pt[] {
  if (ring.length < 3) return ring
  const dedup: Pt[] = []
  for (const p of ring) {
    const l = dedup[dedup.length - 1]
    if (!l || Math.abs(l.x - p.x) > 1e-6 || Math.abs(l.y - p.y) > 1e-6) dedup.push(p)
  }
  if (dedup.length > 1) {
    const a = dedup[0]
    const b = dedup[dedup.length - 1]
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) dedup.pop()
  }
  const out: Pt[] = []
  const n = dedup.length
  for (let i = 0; i < n; i++) {
    const pr = dedup[(i + n - 1) % n]
    const c = dedup[i]
    const nx = dedup[(i + 1) % n]
    const cross = (c.x - pr.x) * (nx.y - pr.y) - (c.y - pr.y) * (nx.x - pr.x)
    if (Math.abs(cross) > 1e-6) out.push(c)
  }
  return out
}

function ringArea(coords: number[][]): number {
  let s = 0
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    s += (coords[j][0] + coords[i][0]) * (coords[j][1] - coords[i][1])
  }
  return Math.abs(s) / 2
}

function featureArea(f: PolyFeature): number {
  const g = f.geometry
  let a = 0
  if (g.type === 'Polygon') {
    a += ringArea(g.coordinates[0])
    for (let i = 1; i < g.coordinates.length; i++) a -= ringArea(g.coordinates[i])
  } else {
    for (const poly of g.coordinates) {
      a += ringArea(poly[0])
      for (let i = 1; i < poly.length; i++) a -= ringArea(poly[i])
    }
  }
  return a
}

function distToRing(p: Pt, ring: Pt[]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const d = pointSegmentDistSq(p.x, p.y, ring[i], ring[(i + 1) % ring.length])
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

function extendToBoundary(line: Pt[], ring: Pt[], threshold: number, ext: number): Pt[] {
  if (line.length < 2) return line
  const out = line.map((p) => ({ ...p }))
  const n = out.length
  if (distToRing(out[0], ring) < threshold) {
    const dx = out[0].x - out[1].x
    const dy = out[0].y - out[1].y
    const l = Math.hypot(dx, dy) || 1
    out[0] = { x: out[0].x + (dx / l) * ext, y: out[0].y + (dy / l) * ext }
  }
  if (distToRing(out[n - 1], ring) < threshold) {
    const dx = out[n - 1].x - out[n - 2].x
    const dy = out[n - 1].y - out[n - 2].y
    const l = Math.hypot(dx, dy) || 1
    out[n - 1] = { x: out[n - 1].x + (dx / l) * ext, y: out[n - 1].y + (dy / l) * ext }
  }
  return out
}

function lotPieces(boundaryRing: Pt[], mainBands: Feature<Polygon>[]): Feature<Polygon>[] {
  let feat: PolyFeature | null = toFeature(boundaryRing)
  for (const band of mainBands) {
    if (!feat) break
    feat = difference(feat, band)
  }
  if (!feat) return []
  const g = feat.geometry
  if (g.type === 'Polygon') return [turf.polygon(g.coordinates)]
  if (g.type === 'MultiPolygon') return g.coordinates.map((rings) => turf.polygon(rings))
  return []
}

// ─── oriented cutting primitives (cuts run along the lot grid frame) ──────────

interface Site {
  id: string
  x: number
  y: number
  w: number // area weight (radius²)
}

/** Clip a convex polygon to the half-plane a·x ≤ b (Sutherland–Hodgman, one edge). */
function clipConvexHalfPlane(poly: Pt[], a: Pt, b: number): Pt[] {
  const out: Pt[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i + n - 1) % n]
    const curIn = a.x * cur.x + a.y * cur.y <= b
    const prevIn = a.x * prev.x + a.y * prev.y <= b
    const cross = () => {
      const dp = a.x * prev.x + a.y * prev.y
      const dc = a.x * cur.x + a.y * cur.y
      const t = (b - dp) / (dc - dp)
      return { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) }
    }
    if (curIn) {
      if (!prevIn) out.push(cross())
      out.push(cur)
    } else if (prevIn) {
      out.push(cross())
    }
  }
  return out
}

const proj = (p: Pt, dir: Pt) => p.x * dir.x + p.y * dir.y

/** Spread (projected range) of a set of sites along `dir` — how far apart the departments sit
 *  on that grid axis. Used to cut perpendicular to where the groups actually separate. */
function siteSpread(sites: Site[], dir: Pt): number {
  let lo = Infinity
  let hi = -Infinity
  for (const s of sites) {
    const u = s.x * dir.x + s.y * dir.y
    if (u < lo) lo = u
    if (u > hi) hi = u
  }
  return hi - lo
}

/** [min,max] projection of a region's outer rings onto `dir`. */
function regionExtent(reg: PolyFeature, dir: Pt): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const ring of outerRings(reg)) {
    for (const p of ring) {
      const u = proj(p, dir)
      if (u < lo) lo = u
      if (u > hi) hi = u
    }
  }
  return [lo, hi]
}

/** Clip a region to the oriented slab { c0 ≤ p·dir ≤ c1 }. */
function clipSlab(reg: PolyFeature, dir: Pt, c0: number, c1: number): PolyFeature | null {
  if (c1 - c0 <= 1e-9) return null
  const [bx0, by0, bx1, by1] = turf.bbox(reg)
  const cx = (bx0 + bx1) / 2
  const cy = (by0 + by1) / 2
  const big = Math.max(bx1 - bx0, by1 - by0) * 2 + 10
  let quad: Pt[] = [
    { x: cx - big, y: cy - big },
    { x: cx + big, y: cy - big },
    { x: cx + big, y: cy + big },
    { x: cx - big, y: cy + big },
  ]
  quad = clipConvexHalfPlane(quad, dir, c1)
  if (quad.length >= 3) quad = clipConvexHalfPlane(quad, { x: -dir.x, y: -dir.y }, -c0)
  if (quad.length < 3) return null
  return intersect(reg, toFeature(quad))
}

/** Binary-search the cut value c along `dir` where area(reg ∩ {p·dir ≤ c}) = target. */
function findAreaCut(reg: PolyFeature, dir: Pt, lo: number, hi: number, target: number): number {
  let a = lo
  let b = hi
  for (let it = 0; it < 22; it++) {
    const m = (a + b) / 2
    const left = clipSlab(reg, dir, lo, m)
    const al = left ? featureArea(left) : 0
    if (al < target) a = m
    else b = m
  }
  return (a + b) / 2
}

/** Snap a cut value along `dir` to the structural grid anchored at `anchor`. */
function snapAlong(c: number, dir: Pt, anchor: Pt, grid: number): number {
  if (grid <= 0) return c
  const a = proj(anchor, dir)
  return a + Math.round((c - a) / grid) * grid
}

/**
 * PASS 1: fill a region by recursively bisecting it among `sites` (departments) with straight,
 * GRID-SNAPPED cuts, area ∝ group weight. Each cut uses the LOCAL grid frame at this sub-region
 * (orientAt) — so the border between two departments aligns to the grid where they actually meet,
 * not one whole-piece orientation (no harsh diagonal across a seam). The cut runs along the grid
 * axis the departments are most SPREAD on (so one clean grid line separates the two groups),
 * unless a MAIN corridor is near — then it fronts the corridor (cut ⟂ the nearest hall).
 */
function guillotine(
  region: PolyFeature,
  sites: Site[],
  grid: number,
  orientAt: (x: number, y: number) => Frame,
  mainSegs: { a: Pt; b: Pt }[],
  reasonableDist: number,
  out: Record<string, PolyFeature>,
): void {
  if (sites.length === 0) return
  if (sites.length === 1) {
    out[sites[0].id] = region
    return
  }
  // Local grid frame for THIS sub-region (where the cut lands), kept grid-snapped via its anchor.
  const [bx0, by0, bx1, by1] = turf.bbox(region)
  const { dirA, dirB, anchor } = orientAt((bx0 + bx1) / 2, (by0 + by1) / 2)
  // Corridor-fronting takes priority; otherwise cut along the axis the departments separate on.
  const cdir = pieceCorridorDir(region, mainSegs, reasonableDist)
  let cutDir: Pt
  if (cdir) {
    cutDir = Math.abs(cdir.x * dirA.x + cdir.y * dirA.y) >= Math.abs(cdir.x * dirB.x + cdir.y * dirB.y) ? dirA : dirB
  } else {
    cutDir = siteSpread(sites, dirA) >= siteSpread(sites, dirB) ? dirA : dirB
  }
  const [lo, hi] = regionExtent(region, cutDir)
  const sorted = [...sites].sort((p, q) => proj(p, cutDir) - proj(q, cutDir))
  const totalW = sorted.reduce((s, d) => s + d.w, 0) || 1
  let acc = 0
  let k = 0
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i].w
    if (acc >= totalW / 2) {
      k = i + 1
      break
    }
  }
  k = Math.max(1, Math.min(sorted.length - 1, k))
  const left = sorted.slice(0, k)
  const right = sorted.slice(k)
  const wLeft = left.reduce((s, d) => s + d.w, 0)
  const totalA = featureArea(region)
  let cut = snapAlong(findAreaCut(region, cutDir, lo, hi, (wLeft / totalW) * totalA), cutDir, anchor, grid)
  // CRITICAL: keep the cut strictly BETWEEN the two groups along cutDir so every department's pin
  // stays inside its OWN cell. The area cut is weight-proportional, so for imbalanced weights it
  // can land on the far side of a pin — which would generate that department's rooms across the
  // floorplan from its pin. Clamp it into the gap between the last left site and first right site.
  const gapLo = proj(sorted[k - 1], cutDir)
  const gapHi = proj(sorted[k], cutDir)
  if (gapHi > gapLo + 1e-6) cut = Math.max(gapLo + 1e-3, Math.min(gapHi - 1e-3, cut))
  cut = Math.max(lo + 1e-3, Math.min(hi - 1e-3, cut))
  const lReg = clipSlab(region, cutDir, lo, cut)
  const rReg = clipSlab(region, cutDir, cut, hi)
  if (lReg) guillotine(lReg, left, grid, orientAt, mainSegs, reasonableDist, out)
  if (rReg) guillotine(rReg, right, grid, orientAt, mainSegs, reasonableDist, out)
}

/** Nearest MAIN-corridor run direction to a piece (for corridor-fronting cuts), or null. */
function pieceCorridorDir(piece: PolyFeature, mainSegs: { a: Pt; b: Pt }[], reasonableDist: number): Pt | null {
  if (mainSegs.length === 0) return null
  const [x0, y0, x1, y1] = turf.bbox(piece)
  const probes: Pt[] = [
    { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
  let best = Infinity
  let bestSeg: { a: Pt; b: Pt } | null = null
  for (const s of mainSegs) {
    for (const p of probes) {
      const d = Math.sqrt(pointSegmentDistSq(p.x, p.y, s.a, s.b))
      if (d < best) {
        best = d
        bestSeg = s
      }
    }
  }
  if (!bestSeg || best > reasonableDist) return null
  const dx = bestSeg.b.x - bestSeg.a.x
  const dy = bestSeg.b.y - bestSeg.a.y
  const l = Math.hypot(dx, dy) || 1
  return { x: dx / l, y: dy / l }
}

/** Which grid axis is PARALLEL to the nearest MAIN corridor ('A'|'B'), or null if none near. */
function corridorAxisChoice(
  cell: PolyFeature,
  dirA: Pt,
  dirB: Pt,
  mainSegs: { a: Pt; b: Pt }[],
  reasonableDist: number,
): 'A' | 'B' | null {
  const cdir = pieceCorridorDir(cell, mainSegs, reasonableDist)
  if (!cdir) return null
  return Math.abs(cdir.x * dirA.x + cdir.y * dirA.y) >= Math.abs(cdir.x * dirB.x + cdir.y * dirB.y) ? 'A' : 'B'
}

/**
 * Quality of a strip set (LOWER is better): rewards the target room count, equal room areas,
 * and low skinniness (aspect ratio measured in the grid frame). Drives the orientation choice
 * so the winning axis yields ~N roughly-equal, non-skinny rooms.
 */
function scoreStripSet(pieces: PolyFeature[], dirA: Pt, dirB: Pt, n: number): number {
  if (pieces.length === 0) return Infinity
  const areas: number[] = []
  let aspectSum = 0
  for (const p of pieces) {
    areas.push(featureArea(p))
    const [a0, a1] = regionExtent(p, dirA)
    const [b0, b1] = regionExtent(p, dirB)
    const la = a1 - a0
    const lb = b1 - b0
    aspectSum += Math.max(la, lb) / Math.max(1e-6, Math.min(la, lb))
  }
  const mean = areas.reduce((s, a) => s + a, 0) / areas.length
  const variance = areas.reduce((s, a) => s + (a - mean) ** 2, 0) / areas.length
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0 // area-equality (coefficient of variation)
  const meanAspect = aspectSum / pieces.length // skinniness
  const countDeficit = Math.max(0, n - pieces.length) / Math.max(1, n) // missed the target N (slivers capped)
  return countDeficit * 6 + meanAspect + cv * 2
}

/**
 * Choose the strip orientation by TESTING BOTH grid axes and slicing each into ~n strips: the
 * option that scores best (roughly-equal, less-skinny rooms hitting the target count) wins, so
 * rooms never come out skinny just to follow a heuristic. When the two are within a slim margin,
 * the corridor-parallel axis breaks the tie — keeping rooms fronting the desired circulation.
 * Returns the winning strips directly (no re-slice).
 */
function chooseStripSlicing(
  cell: PolyFeature,
  n: number,
  grid: number,
  minWidth: number,
  dirA: Pt,
  dirB: Pt,
  anchor: Pt,
  mainSegs: { a: Pt; b: Pt }[],
  reasonableDist: number,
): PolyFeature[] {
  const piecesA: PolyFeature[] = []
  const piecesB: PolyFeature[] = []
  linearStripSlice(cell, n, grid, minWidth, dirA, anchor, piecesA)
  linearStripSlice(cell, n, grid, minWidth, dirB, anchor, piecesB)
  const sA = scoreStripSet(piecesA, dirA, dirB, n)
  const sB = scoreStripSet(piecesB, dirA, dirB, n)

  let useA = sA <= sB
  // Near-tie ⇒ prefer the corridor-parallel axis so the fingers front the circulation path.
  if (Math.abs(sA - sB) <= 0.15 * Math.min(sA, sB)) {
    const corridor = corridorAxisChoice(cell, dirA, dirB, mainSegs, reasonableDist)
    if (corridor) useA = corridor === 'A'
  }
  return useA ? piecesA : piecesB
}

/**
 * PASS 2 — LINEAR STRIP SLICER. Partition a cell into ~k equal-area strips along a SINGLE
 * locked grid axis `cutDir` (no recursive axis-alternating), with grid-snapped walls running
 * perpendicular to it. Because the direction never flips, every strip keeps one orientation —
 * and when `cutDir` is the corridor-parallel grid axis (see stripCutAxis), each strip is a
 * "finger" with direct corridor frontage. The strip count is capped so none becomes a sliver
 * thinner than the min room width (a target N — fewer, fuller rooms beat slivers).
 */
function linearStripSlice(
  region: PolyFeature,
  k: number,
  grid: number,
  minWidth: number,
  cutDir: Pt,
  anchor: Pt,
  out: PolyFeature[],
): void {
  const [lo, hi] = regionExtent(region, cutDir)
  const ext = hi - lo
  const maxStrips = Math.max(1, Math.floor(ext / Math.max(1e-6, minWidth)))
  const strips = Math.max(1, Math.min(k, maxStrips))
  if (strips <= 1) {
    out.push(region)
    return
  }
  const total = featureArea(region)
  const minStep = Math.min(minWidth, ext / strips)
  let prev = lo
  for (let i = 1; i <= strips; i++) {
    let cut: number
    if (i === strips) {
      cut = hi
    } else {
      // Equal-area cut position along the single axis, snapped to the grid, kept monotonic
      // with at least one min-width of spacing from the previous wall.
      cut = snapAlong(findAreaCut(region, cutDir, lo, hi, (i / strips) * total), cutDir, anchor, grid)
      cut = Math.max(prev + minStep, Math.min(hi - minStep, cut))
    }
    const slab = clipSlab(region, cutDir, prev, cut)
    if (slab) out.push(slab)
    prev = cut
  }
}

function sliceCellIntoRooms(
  cell: PolyFeature,
  dept: Department,
  minorBands: Feature<Polygon>[],
  mpu: number | null,
  grid: number,
  minWidth: number,
  dirA: Pt,
  dirB: Pt,
  anchor: Pt,
  mainSegs: { a: Pt; b: Pt }[],
  reasonableDist: number,
  rooms: Room[],
): void {
  const n = dept.roomCount ?? 0
  if (n < 1) return
  // PASS 2: slice into linear strips, but CHOOSE the grid orientation by quality — test both
  // axes and keep the one that yields ~n roughly-equal, less-skinny rooms (corridor-parallel
  // breaks near-ties so rooms still front the circulation). Strips run true to the grid.
  const pieces = chooseStripSlicing(cell, n, grid, minWidth, dirA, dirB, anchor, mainSegs, reasonableDist)

  for (const piece of pieces) {
    let feat: PolyFeature | null = piece
    for (const band of minorBands) {
      feat = difference(feat, band)
      if (!feat) break
    }
    if (!feat) continue
    for (const raw of outerRings(feat)) {
      const r = simplifyRing(raw)
      if (r.length < 3) continue
      const areaWorld = polygonAreaWorld(r)
      if (areaWorld < MIN_ROOM_WORLD_AREA) continue
      rooms.push({
        roomId: `room-${roomSeq++}`,
        parentDeptId: dept.id,
        polygon: r,
        areaSqf: mpu != null && mpu > 0 ? worldAreaToSqft(areaWorld, mpu) : areaWorld,
        isLocked: false,
      })
    }
  }
}

/**
 * Split `n` rooms across cells of the given areas: proportional to area, every cell ≥ 1 so
 * no region is left unfilled. The total stays exactly `n` when n ≥ cells; if there are more
 * regions than rooms each region still gets 1 (total may exceed n — an extra room beats an
 * empty region).
 */
export function allocateCounts(areas: number[], n: number): number[] {
  const k = areas.length
  if (k === 0) return []
  if (n <= k) return areas.map(() => 1)
  const total = areas.reduce((s, a) => s + a, 0) || 1
  const quota = areas.map((a) => (n * a) / total)
  const counts = quota.map((q) => Math.max(1, Math.floor(q)))
  let sum = counts.reduce((s, c) => s + c, 0)
  const byFrac = quota.map((q, i) => ({ i, frac: q - Math.floor(q) })).sort((p, q2) => q2.frac - p.frac)
  let oi = 0
  while (sum < n) {
    counts[byFrac[oi % k].i]++
    sum++
    oi++
  }
  while (sum > n) {
    let bi = -1
    let bq = Infinity
    for (let i = 0; i < k; i++) if (counts[i] > 1 && quota[i] < bq) { bq = quota[i]; bi = i }
    if (bi < 0) break
    counts[bi]--
    sum--
  }
  return counts
}

/**
 * Slice one department's cell into rooms, RESPECTING MULTIPLE GRID ORIENTATIONS: if the cell
 * straddles more than one structural-grid region (the user drew seams that gave the lot
 * regions at different orientations), the cell is partitioned by region and each part is
 * sliced along ITS OWN grid — so the department gets one room CLUSTER per orientation, each
 * running true to its grid. A cell within a single region slices in that one orientation
 * (the original behavior). Room count is shared across the clusters by area.
 */
function sliceDeptAcrossRegions(
  cell: PolyFeature,
  dept: Department,
  regions: { feat: PolyFeature; frame: Frame }[],
  orientAt: (x: number, y: number) => Frame,
  minorBands: Feature<Polygon>[],
  mpu: number | null,
  grid: number,
  minWidth: number,
  mainSegs: { a: Pt; b: Pt }[],
  reasonableDist: number,
  rooms: Room[],
): void {
  const n = dept.roomCount ?? 0
  if (n < 1) return

  // Partition the department cell by grid region. Each part remembers WHICH region it came from
  // (regionIdx), so leftover area can be given the same region's orientation later. robustIntersect
  // retries cleaned coords so a region is not silently dropped (which would collapse a straddling
  // department to a single orientation).
  type Part = { feat: PolyFeature; frame: Frame; area: number; cx: number; cy: number; regionIdx: number }
  const parts: Part[] = []
  regions.forEach((r, idx) => {
    const inter = robustIntersect(cell, r.feat)
    if (!inter) return
    let area = 0
    for (const ring of outerRings(inter)) area += polygonAreaWorld(ring)
    if (area < MIN_ROOM_WORLD_AREA) return
    const [bx0, by0, bx1, by1] = turf.bbox(inter)
    parts.push({ feat: inter, frame: r.frame, area, cx: (bx0 + bx1) / 2, cy: (by0 + by1) / 2, regionIdx: idx })
  })

  // No region intersected the cell at all (degenerate geometry) ⇒ fall back to the cell-center
  // frame and slice once.
  if (parts.length === 0) {
    const [bx0, by0, bx1, by1] = turf.bbox(cell)
    const f = orientAt((bx0 + bx1) / 2, (by0 + by1) / 2)
    sliceCellIntoRooms(cell, dept, minorBands, mpu, grid, minWidth, f.dirA, f.dirB, f.anchor, mainSegs, reasonableDist, rooms)
    return
  }

  // RECLAIM LEFTOVER (cell minus the region parts): the thin seam band lotGridRegions leaves
  // between regions, PLUS any region chunk turf's first intersect dropped. Each leftover piece
  // is given the orientation of the region it actually sits in — recovering a whole region as its
  // OWN cluster when needed — so the seam closes cleanly without contaminating an orientation.
  // Only a true seam-gap sliver (in no region) falls back to the nearest cluster.
  let covered: PolyFeature | null = null
  for (const p of parts) covered = covered ? unionFeat(covered, p.feat) ?? covered : p.feat
  if (covered) {
    const leftover = difference(cell, covered)
    if (leftover) {
      for (const ring of outerRings(leftover)) {
        const a = polygonAreaWorld(ring)
        if (a < MIN_ROOM_WORLD_AREA) continue // sub-threshold crumb — ignore
        let mx = 0
        let my = 0
        for (const pt of ring) {
          mx += pt.x
          my += pt.y
        }
        mx /= ring.length
        my /= ring.length
        const ridx = regions.findIndex((r) => pointInFeature(r.feat, mx, my))
        let target = ridx >= 0 ? parts.find((p) => p.regionIdx === ridx) : undefined
        if (!target && ridx >= 0) {
          // A region turf failed to intersect — recover it as its OWN cluster (its grid).
          target = { feat: toFeature(ring), frame: regions[ridx].frame, area: 0, cx: mx, cy: my, regionIdx: ridx }
          parts.push(target)
        }
        if (!target) {
          // Seam-gap sliver in no region ⇒ nearest cluster keeps it (orientation negligible).
          let bestD = Infinity
          for (const p of parts) {
            const d = (p.cx - mx) ** 2 + (p.cy - my) ** 2
            if (d < bestD) {
              bestD = d
              target = p
            }
          }
        }
        if (!target) continue
        const merged = unionFeat(target.feat, toFeature(ring))
        if (merged) {
          target.feat = merged
          target.area += a
        }
      }
    }
  }

  // One region under the whole cell ⇒ slice once in THAT region's frame (NOT orientAt(center),
  // which returns the whole-lot orientation when the center lands in the seam gap).
  if (parts.length === 1) {
    const p = parts[0]
    sliceCellIntoRooms(p.feat, dept, minorBands, mpu, grid, minWidth, p.frame.dirA, p.frame.dirB, p.frame.anchor, mainSegs, reasonableDist, rooms)
    return
  }

  // Straddles ≥2 grids: a room cluster per region, sized to its share, sliced along its grid.
  const counts = allocateCounts(parts.map((p) => p.area), n)
  parts.forEach((p, i) => {
    if (counts[i] < 1) return
    sliceCellIntoRooms(
      p.feat,
      { ...dept, roomCount: counts[i] },
      minorBands,
      mpu,
      grid,
      minWidth,
      p.frame.dirA,
      p.frame.dirB,
      p.frame.anchor,
      mainSegs,
      reasonableDist,
      rooms,
    )
  })
}

// ─── PASS 4 — sliver absorption (push/pull cleanup) ──────────────────────────

function unionFeat(a: PolyFeature, b: PolyFeature): PolyFeature | null {
  try {
    return turf.union(turf.featureCollection([a, b])) as PolyFeature | null
  } catch {
    return null
  }
}

interface Item {
  room: Room
  feat: PolyFeature
}

/** Sliver absorption: a room below the viable area, or thinner than minDim along EITHER
 *  grid axis, is merged (turf.union) into the adjacent room whose union stays most
 *  rectangular (preferring same department), then spliced out. */
function absorbSlivers(
  rooms: Room[],
  mpu: number | null,
  orientAt: (cx: number, cy: number) => Frame,
): Room[] {
  if (rooms.length < 2) return rooms
  const hasScale = mpu != null && mpu > 0
  const minDim = hasScale ? 5 / (mpu * M_TO_FT) : 10
  const minArea = hasScale ? sqftToWorldArea(40, mpu) : minDim * minDim

  const items: Item[] = rooms.map((room) => ({ room, feat: toFeature(room.polygon) }))
  const skip = new Set<string>()

  // Measure each room in ITS OWN region's grid frame (rooms in a rotated seam-region are
  // still rectangular relative to that region, not world axes).
  const frameOfRing = (ring: Pt[]): Frame => {
    let cx = 0
    let cy = 0
    for (const p of ring) {
      cx += p.x
      cy += p.y
    }
    return orientAt(cx / ring.length, cy / ring.length)
  }
  const orientedMinDim = (ring: Pt[]): number => {
    const { dirA, dirB } = frameOfRing(ring)
    const [a0, a1] = [Math.min(...ring.map((p) => proj(p, dirA))), Math.max(...ring.map((p) => proj(p, dirA)))]
    const [b0, b1] = [Math.min(...ring.map((p) => proj(p, dirB))), Math.max(...ring.map((p) => proj(p, dirB)))]
    return Math.min(a1 - a0, b1 - b0)
  }
  const isSliver = (it: Item): boolean => {
    if (skip.has(it.room.roomId)) return false
    const ring = it.room.polygon
    if (polygonAreaWorld(ring) < minArea) return true
    return orientedMinDim(ring) < minDim
  }

  let guard = items.length * 2 + 8
  while (guard-- > 0) {
    const idx = items.findIndex(isSliver)
    if (idx < 0) break
    const s = items[idx]
    const sFrame = frameOfRing(s.room.polygon)
    let best = -1
    let bestScore = Infinity
    let bestRing: Pt[] | null = null
    for (let j = 0; j < items.length; j++) {
      if (j === idx) continue
      const c = items[j]
      let touches = false
      try {
        touches = turf.booleanIntersects(s.feat, c.feat)
      } catch {
        touches = false
      }
      if (!touches) continue
      // Don't merge ACROSS grid orientations (e.g. a sliver on one side of a seam into a room
      // on the other): the union would mix two grid directions and read as an arbitrary diagonal.
      // Rooms only ever merge with a neighbor that shares their grid frame, so each stays
      // single-orientation. (Same-region neighbors have dirA·dirA ≈ 1; a rotated region ≪ 1.)
      const cFrame = frameOfRing(c.room.polygon)
      if (Math.abs(sFrame.dirA.x * cFrame.dirA.x + sFrame.dirA.y * cFrame.dirA.y) < 0.985) continue
      const u = unionFeat(s.feat, c.feat)
      if (!u || u.geometry.type !== 'Polygon') continue
      const ring = simplifyRing(outerRings(u)[0])
      if (ring.length < 3) continue
      const inflation = Math.max(0, ring.length - simplifyRing(c.room.polygon).length)
      const { dirA, dirB } = frameOfRing(ring)
      const [a0, a1] = [Math.min(...ring.map((p) => proj(p, dirA))), Math.max(...ring.map((p) => proj(p, dirA)))]
      const [b0, b1] = [Math.min(...ring.map((p) => proj(p, dirB))), Math.max(...ring.map((p) => proj(p, dirB)))]
      const w = a1 - a0
      const h = b1 - b0
      const aspect = Math.max(w, h) / Math.max(1e-6, Math.min(w, h))
      const rect = polygonAreaWorld(ring) / Math.max(1e-6, w * h)
      const sameDept = c.room.parentDeptId === s.room.parentDeptId ? 1 : 0
      const score = inflation * 1.0 + Math.max(0, aspect - 2) * 2.0 + (1 - rect) * 4.0 - sameDept * 0.75
      if (score < bestScore) {
        bestScore = score
        best = j
        bestRing = ring
      }
    }
    if (best < 0 || !bestRing) {
      skip.add(s.room.roomId)
      continue
    }
    const winner = items[best]
    const areaWorld = polygonAreaWorld(bestRing)
    winner.room = {
      ...winner.room,
      polygon: bestRing,
      areaSqf: hasScale ? worldAreaToSqft(areaWorld, mpu) : areaWorld,
    }
    winner.feat = toFeature(bestRing)
    items.splice(idx, 1)
  }
  return items.map((it) => it.room)
}

export function generateRooms(
  departments: Department[],
  boundary: Boundary | null,
  circulationPaths: CirculationPath[],
  mpu: number | null,
  gridSpacing: number,
  seams: Pt[][] = [],
  lockedRooms: Room[] = [],
): Room[] {
  if (!boundary || boundary.isClosed === false || boundary.ring.length < 3) return []
  const ring = boundary.ring

  // A department contributes rooms if it has a grain (primary control → derived count) or a
  // manual room count ≥ 1. grain 0 still yields one (open-plan) room.
  const active = departments.filter((d) => d.grain != null || (d.roomCount ?? 0) >= 1)
  if (active.length === 0) return []

  let lminX = Infinity
  let lminY = Infinity
  let lmaxX = -Infinity
  let lmaxY = -Infinity
  for (const p of ring) {
    if (p.x < lminX) lminX = p.x
    if (p.y < lminY) lminY = p.y
    if (p.x > lmaxX) lmaxX = p.x
    if (p.y > lmaxY) lmaxY = p.y
  }
  const lotW = lmaxX - lminX
  const lotH = lmaxY - lminY
  const diag = Math.hypot(lotW, lotH)
  const splitExt = Math.max(lotW, lotH)

  // Per-region grid frames: each seam-split region has its OWN best-fit orientation — the
  // same grid circulation snaps to. Rooms in a region are cut in THAT region's frame, so
  // they run true to the walls / parallel to the circulation drawn there (not a single
  // whole-lot orientation). Falls back to the dominant orientation outside all regions.
  const frameOf = (ori: number, anchor: Pt): Frame => {
    const dirA: Pt = { x: Math.cos(ori), y: Math.sin(ori) }
    return { dirA, dirB: { x: -dirA.y, y: dirA.x }, anchor }
  }
  const dom = dominantLotOrientation(ring)
  const domFrame: Frame = dom ? frameOf(dom.ori, dom.anchor) : frameOf(0, { x: lminX, y: lminY })
  const regions = lotGridRegions(ring, Math.max(4, gridSpacing), seams).map((r) => {
    let cx = 0
    let cy = 0
    for (const p of r.ring) {
      cx += p.x
      cy += p.y
    }
    return { feat: toFeature(r.ring), frame: frameOf(r.ori, r.anchor), cx: cx / r.ring.length, cy: cy / r.ring.length }
  })
  const orientAt = (px: number, py: number): Frame => {
    const pt = turf.point([px, py])
    for (const r of regions) {
      try {
        if (turf.booleanPointInPolygon(pt, r.feat)) return r.frame
      } catch {
        /* ignore */
      }
    }
    // Inside no region (e.g. a point in the thin seam gap): use the NEAREST region's frame, not
    // the whole-lot dominant orientation — so seam-adjacent rooms are judged in their real grid.
    let best: Frame = domFrame
    let bestD = Infinity
    for (const r of regions) {
      const d = (r.cx - px) ** 2 + (r.cy - py) ** 2
      if (d < bestD) {
        bestD = d
        best = r.frame
      }
    }
    return best
  }
  const grid = Math.max(4, gridSpacing)

  let minWidth = mpu != null && mpu > 0 ? MIN_ROOM_FT / (mpu * M_TO_FT) : Math.max(2 * grid, 18)
  minWidth = Math.min(minWidth, Math.min(lotW, lotH) * 0.4)

  const mainBands = circulationPaths
    .filter((p) => p.tier !== 'MINOR')
    .map((p) =>
      centerlineToBandRing(extendToBoundary(p.centerline, ring, Math.max(p.width, diag * 0.02), splitExt), p.width),
    )
    .filter((r) => r.length >= 3)
    .map(toFeature)
  const minorBands = circulationPaths
    .filter((p) => p.tier === 'MINOR')
    .map((p) => centerlineToBandRing(p.centerline, p.width))
    .filter((r) => r.length >= 3)
    .map(toFeature)

  // LOCKED ROOMS are frozen keep-outs: subtract them from the workable area so freshly
  // generated rooms reflow AROUND the regions the user has locked (the locked rooms
  // themselves are re-appended by the caller). Treated exactly like MAIN corridor bands.
  const lockBands = lockedRooms
    .map((r) => r.polygon)
    .filter((ring2) => ring2.length >= 3)
    .map(toFeature)
  const pieces = lotPieces(ring, [...mainBands, ...lockBands])
  if (pieces.length === 0) return []

  const mainSegs: { a: Pt; b: Pt }[] = []
  for (const p of circulationPaths) {
    if (p.tier === 'MINOR') continue
    for (let i = 0; i < p.centerline.length - 1; i++) mainSegs.push({ a: p.centerline[i], b: p.centerline[i + 1] })
  }
  const reasonableDist = diag * 0.4

  const pieceOf = active.map((d) => {
    const pt = turf.point([d.x, d.y])
    return pieces.findIndex((pc) => {
      try {
        return turf.booleanPointInPolygon(pt, pc)
      } catch {
        return false
      }
    })
  })

  const rooms: Room[] = []
  pieces.forEach((piece, pi) => {
    const group: Site[] = []
    active.forEach((d, i) => {
      if (pieceOf[i] === pi) group.push({ id: d.id, x: d.x, y: d.y, w: Math.max(1, d.radius * d.radius) })
    })
    if (group.length === 0) return
    // Department-splitting cuts use the LOCAL grid frame at each cut (orientAt), so the border
    // between two departments aligns to the grid where they meet — even across a seam.
    const cells: Record<string, PolyFeature> = {}
    guillotine(piece, group, grid, orientAt, mainSegs, reasonableDist, cells)
    for (const d of active) {
      const cell = cells[d.id]
      if (!cell) continue
      // GRAIN: when a department carries a grain, the effective room count is derived from
      // its actual cell area (open-plan → few large rooms, cellular → many small) — so the
      // same grain yields proportionally more rooms in a bigger department. A manual
      // roomCount (no grain) is used as-is.
      const effN = effectiveCount(d, featureArea(cell), mpu, grid)
      const sd = d.grain != null ? { ...d, roomCount: effN } : d
      // Each department's rooms follow its region's grid frame — and if the cell spans
      // MULTIPLE grids (regions at different orientations), it gets one room cluster per
      // grid, each running true to its own orientation. PASS 2 slices each cell into linear
      // strips along its corridor-parallel grid axis (mainSegs/reasonableDist) for frontage.
      sliceDeptAcrossRegions(cell, sd, regions, orientAt, minorBands, mpu, grid, minWidth, mainSegs, reasonableDist, rooms)
    }
  })

  return absorbSlivers(rooms, mpu, orientAt)
}
