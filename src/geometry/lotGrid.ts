import * as turf from '@turf/turf'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { pointInPolygon } from './locks'
import { pointSegmentDistSq } from './graph'
import { centerlineToBandRing } from './corridor'

/**
 * Structural grid for a closed lot (foundation for orientation-aware room generation).
 *
 * By default the lot gets exactly ONE grid, oriented by best fit to its edges (the edge
 * family covering the most boundary length; short detail edges are ignored). The ONLY
 * way to get more than one grid is for the user to draw SEAMS (open polylines, vertex to
 * vertex) with the Polyline tool on the Boundary layer: each seam is a straight divider
 * that splits the lot into regions, and each region gets its own best-fit grid. Region
 * hand-off is a clean straight slice along the seam line (exact half-plane clipping).
 */

type Pt = { x: number; y: number }

export interface LotGridSet {
  /** Grid base orientation in radians (lines run at `angle` and `angle` + 90°). */
  angle: number
  /** Clipped grid line segments [start, end] in world coordinates. */
  segments: [Pt, Pt][]
  /** Grid intersection nodes (lattice points inside this region). */
  nodes: Pt[]
}

const MERGE_TOL = (5 * Math.PI) / 180
const COVER_TOL = (14 * Math.PI) / 180
const MIN_SIGNIFICANT_FRAC = 0.12 // edges shorter than this × the longest don't pick the grid

/** Planar |area| of a polygon ring (shoelace). */
function ringAreaAbs(r: Pt[]): number {
  let s = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j].x + r[i].x) * (r[j].y - r[i].y)
  return Math.abs(s) / 2
}

/** Shortest distance from a point to a polygon ring's edges. */
function distToRing(p: Pt, ring: Pt[]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const d = pointSegmentDistSq(p.x, p.y, ring[i], ring[(i + 1) % ring.length])
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

function oriDist(a: number, b: number): number {
  const p = Math.PI / 2
  let d = Math.abs(a - b) % p
  if (d > p / 2) d = p - d
  return d
}

interface Edge {
  ori: number
  len: number
  a: Pt
  mid: Pt
}

function lotEdges(ring: Pt[]): Edge[] {
  const n = ring.length
  const edges: Edge[] = []
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1e-6) continue
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    edges.push({
      ori: ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2),
      len,
      a,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    })
  }
  return edges
}

/** The single best-fit grid orientation for a set of edges (covers the most significant
 *  edge length), with an anchor on the longest satisfied edge so the grid runs true. */
function bestFitOrientation(edges: Edge[]): { ori: number; anchor: Pt } {
  if (edges.length === 0) return { ori: 0, anchor: { x: 0, y: 0 } }
  let longest = 0
  for (const e of edges) if (e.len > longest) longest = e.len
  const minSig = longest * MIN_SIGNIFICANT_FRAC
  let sig = edges.filter((e) => e.len >= minSig)
  if (sig.length === 0) sig = edges

  const candidates: number[] = []
  for (const e of [...sig].sort((p, q) => q.len - p.len)) {
    if (!candidates.some((o) => oriDist(o, e.ori) < MERGE_TOL)) candidates.push(e.ori)
  }
  let bestOri = candidates[0] ?? 0
  let bestCover = -1
  for (const cand of candidates) {
    let cover = 0
    for (const e of sig) if (oriDist(cand, e.ori) < COVER_TOL) cover += e.len
    if (cover > bestCover) {
      bestCover = cover
      bestOri = cand
    }
  }
  let anchor: Pt | null = null
  let bestLen = -1
  let fbAnchor = edges[0].a
  let fbLen = -1
  for (const e of edges) {
    if (e.len > fbLen) {
      fbLen = e.len
      fbAnchor = e.a
    }
    if (oriDist(e.ori, bestOri) < COVER_TOL && e.len > bestLen) {
      bestLen = e.len
      anchor = e.a
    }
  }
  return { ori: bestOri, anchor: anchor ?? fbAnchor }
}

/** Whole-lot dominant grid orientation (room generation aligns its cuts to this). */
export function dominantLotOrientation(ring: Pt[]): { ori: number; anchor: Pt } | null {
  const edges = lotEdges(ring)
  if (edges.length === 0) return null
  return bestFitOrientation(edges)
}

/** Inside sub-segments of the infinite line (p0 + t·dir) clipped to the polygon. */
function clipLine(p0: Pt, dir: Pt, ring: Pt[]): [Pt, Pt][] {
  const n = ring.length
  const ts: number[] = []
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const ex = b.x - a.x
    const ey = b.y - a.y
    const det = ex * dir.y - dir.x * ey
    if (Math.abs(det) < 1e-9) continue
    const wx = a.x - p0.x
    const wy = a.y - p0.y
    const t = (-wx * ey + ex * wy) / det
    const s = (dir.x * wy - dir.y * wx) / det
    if (s >= -1e-9 && s <= 1 + 1e-9) ts.push(t)
  }
  ts.sort((p, q) => p - q)
  const uniq: number[] = []
  for (const t of ts) if (!uniq.length || Math.abs(t - uniq[uniq.length - 1]) > 1e-6) uniq.push(t)
  const out: [Pt, Pt][] = []
  for (let i = 0; i + 1 < uniq.length; i++) {
    const tm = (uniq[i] + uniq[i + 1]) / 2
    if (pointInPolygon(p0.x + dir.x * tm, p0.y + dir.y * tm, ring)) {
      out.push([
        { x: p0.x + dir.x * uniq[i], y: p0.y + dir.y * uniq[i] },
        { x: p0.x + dir.x * uniq[i + 1], y: p0.y + dir.y * uniq[i + 1] },
      ])
    }
  }
  return out
}

/** One grid: two perpendicular line families at `ori`, clipped to `clipRing` (the lot, or
 *  a seam-split sub-piece of it). */
function buildGrid(clipRing: Pt[], spacing: number, ori: number, anchor: Pt): LotGridSet {
  const dir = { x: Math.cos(ori), y: Math.sin(ori) }
  const perp = { x: -Math.sin(ori), y: Math.cos(ori) }
  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  for (const p of clipRing) {
    const u = p.x * dir.x + p.y * dir.y
    const v = p.x * perp.x + p.y * perp.y
    if (u < uMin) uMin = u
    if (u > uMax) uMax = u
    if (v < vMin) vMin = v
    if (v > vMax) vMax = v
  }
  const u0 = anchor.x * dir.x + anchor.y * dir.y
  const v0 = anchor.x * perp.x + anchor.y * perp.y
  const segments: [Pt, Pt][] = []
  for (let k = Math.floor((vMin - v0) / spacing); k <= Math.ceil((vMax - v0) / spacing); k++) {
    const v = v0 + k * spacing
    for (const seg of clipLine({ x: perp.x * v, y: perp.y * v }, dir, clipRing)) segments.push(seg)
  }
  for (let k = Math.floor((uMin - u0) / spacing); k <= Math.ceil((uMax - u0) / spacing); k++) {
    const u = u0 + k * spacing
    for (const seg of clipLine({ x: dir.x * u, y: dir.y * u }, perp, clipRing)) segments.push(seg)
  }

  // Lattice intersection nodes inside the clip region.
  const nodes: Pt[] = []
  for (let i = Math.floor((uMin - u0) / spacing); i <= Math.ceil((uMax - u0) / spacing); i++) {
    const u = u0 + i * spacing
    for (let j = Math.floor((vMin - v0) / spacing); j <= Math.ceil((vMax - v0) / spacing); j++) {
      const v = v0 + j * spacing
      const px = dir.x * u + perp.x * v
      const py = dir.y * u + perp.y * v
      if (pointInPolygon(px, py, clipRing)) nodes.push({ x: px, y: py })
    }
  }
  return { angle: ori, segments, nodes }
}

// ─── seam-based lot splitting (turf) — a seam is a CHORD that cuts the lot into real
//     sub-pieces, so it only divides where it is drawn (no infinite-line phantom seams). ──

type PolyFeat = Feature<Polygon | MultiPolygon>

function toFeature(r: Pt[]): Feature<Polygon> {
  const coords = r.map((p) => [p.x, p.y])
  coords.push([r[0].x, r[0].y])
  return turf.polygon([coords])
}

function difference(a: PolyFeat, b: PolyFeat): PolyFeat | null {
  try {
    return (turf.difference(turf.featureCollection([a, b])) as PolyFeat | null) ?? null
  } catch {
    return a
  }
}

/** Outer rings of a turf polygon / multipolygon (closing vertex dropped). */
function piecesOf(f: PolyFeat | null): Pt[][] {
  if (!f) return []
  const g = f.geometry
  const ringToPts = (c: number[][]) => c.slice(0, -1).map(([x, y]) => ({ x, y }))
  if (g.type === 'Polygon') return [ringToPts(g.coordinates[0])]
  if (g.type === 'MultiPolygon') return g.coordinates.map((poly) => ringToPts(poly[0]))
  return []
}

/** Extend a seam's endpoints outward so its (thin) cut band crosses the boundary cleanly. */
function extendSeam(s: Pt[], ext: number): Pt[] {
  const out = s.map((p) => ({ ...p }))
  const n = out.length
  const push = (i: number, j: number) => {
    const dx = out[i].x - out[j].x
    const dy = out[i].y - out[j].y
    const L = Math.hypot(dx, dy) || 1
    out[i] = { x: out[i].x + (dx / L) * ext, y: out[i].y + (dy / L) * ext }
  }
  push(0, 1)
  push(n - 1, n - 2)
  return out
}

/** A region of the lot grid: a polygon (whole lot, or a seam-split piece) with its
 *  best-fit orientation. Drives both the grid render AND room generation (rooms in a
 *  region follow its orientation — the same grid circulation snaps to). */
export interface LotRegion {
  ring: Pt[]
  ori: number
  anchor: Pt
}

/**
 * Partition the lot into grid regions (one per seam-split piece, or the whole lot when
 * there are no seams), each tagged with its best-fit orientation + grid anchor.
 */
export function lotGridRegions(ring: Pt[], spacing: number, seams: Pt[][] = []): LotRegion[] {
  if (ring.length < 3 || spacing <= 0) return []
  const edges = lotEdges(ring)
  if (edges.length === 0) return []

  const whole = (): LotRegion[] => {
    const o = bestFitOrientation(edges)
    return [{ ring, ori: o.ori, anchor: o.anchor }]
  }

  const valid = seams.filter((s) => s.length >= 2)
  if (valid.length === 0) return whole()

  // Split the lot into pieces by cutting thin bands along each seam chord.
  let mnx = Infinity
  let mny = Infinity
  let mxx = -Infinity
  let mxy = -Infinity
  for (const p of ring) {
    if (p.x < mnx) mnx = p.x
    if (p.y < mny) mny = p.y
    if (p.x > mxx) mxx = p.x
    if (p.y > mxy) mxy = p.y
  }
  // Extend seam ends only modestly past the (snapped) boundary — just enough to cut
  // cleanly through. A large extension can clip far parts of a concave lot and split off
  // unintended sliver pieces (each of which would draw its own stray grid).
  const ext = Math.max(10, Math.hypot(mxx - mnx, mxy - mny) * 0.02)
  const cutWidth = Math.max(2, Math.min(mxx - mnx, mxy - mny) * 0.004)
  let feat: PolyFeat | null = toFeature(ring)
  for (const s of valid) {
    if (!feat) break
    const band = centerlineToBandRing(extendSeam(s, ext), cutWidth)
    if (band.length >= 3) feat = difference(feat, toFeature(band))
  }

  // Drop sub-threshold sliver pieces (turf artifacts / over-cut crumbs) so they never
  // render a tiny grid — only real regions (≥ one grid module of area) keep a grid.
  const minPieceArea = spacing * spacing
  const pieces = piecesOf(feat).filter((p) => p.length >= 3 && ringAreaAbs(p) >= minPieceArea)

  // Seams didn't actually split the lot into ≥2 real regions ⇒ a single grid.
  if (pieces.length <= 1) return whole()

  // One best-fit grid per piece, clipped to that piece (clean per-region grids).
  // SEAM ALIGNMENT: a piece bordering a seam anchors its grid to that seam's shared
  // endpoint (a boundary vertex), so adjacent grids each get a NODE there and meet at
  // that vertex. Only the phase shifts — orientation and (global) spacing are unchanged.
  // Assign each lot boundary edge to the piece it borders. The edge midpoint lies ON the
  // piece boundary (where point-in-polygon is unreliable), so probe a touch INSIDE along
  // the edge's inward normal — this is what lets each region fit its grid to ITS OWN
  // dominant edges (rather than all falling back to the whole-lot orientation).
  const probeDelta = Math.max(4, spacing * 0.25)
  const edgePiece = edges.map((e) => {
    const dx = e.mid.x - e.a.x
    const dy = e.mid.y - e.a.y
    const L = Math.hypot(dx, dy) || 1
    const nx = -dy / L
    const ny = dx / L
    let px = e.mid.x + nx * probeDelta
    let py = e.mid.y + ny * probeDelta
    if (!pointInPolygon(px, py, ring)) {
      px = e.mid.x - nx * probeDelta
      py = e.mid.y - ny * probeDelta
    }
    return pieces.findIndex((pc) => pointInPolygon(px, py, pc))
  })

  const seamEps = Math.max(6, cutWidth * 4)
  const regions: LotRegion[] = []
  pieces.forEach((piece, pi) => {
    if (piece.length < 3) return
    const pe = edges.filter((_, idx) => edgePiece[idx] === pi)
    const o = bestFitOrientation(pe.length ? pe : edges) // region's own best-fit orientation
    let anchor = o.anchor
    for (const s of valid) {
      if (distToRing(s[0], piece) < seamEps) {
        anchor = s[0] // shared seam endpoint → both sides snap a grid node here
        break
      }
    }
    regions.push({ ring: piece, ori: o.ori, anchor })
  })
  return regions
}

/** Build the renderable grid line sets from the lot regions. */
export function buildLotGrid(ring: Pt[], spacing: number, seams: Pt[][] = []): LotGridSet[] {
  return lotGridRegions(ring, spacing, seams)
    .map((r) => buildGrid(r.ring, spacing, r.ori, r.anchor))
    .filter((g) => g.segments.length)
}
