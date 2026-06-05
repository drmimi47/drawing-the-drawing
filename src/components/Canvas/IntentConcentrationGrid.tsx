import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import { INTENT_META, INTENT_TYPES, type IntentPin, type IntentType } from '../../types/geometry'
import { evaluatePinField } from '../../utils/metaballField'
import { useDrawingStore } from '../../store/drawingStore'
import { lotGridRegions, dominantLotOrientation } from '../../geometry/lotGrid'
import type { FieldClip } from './MetaballOverlay'

/**
 * Intent concentration grid (hover preview over the "Adjust" button).
 *
 * The cells are ORIENTED to the lot's internal structural grid — each lot grid region
 * (seam-split) contributes its own orientation, and the lattice is EXTENDED beyond the lot
 * boundary (a cell outside the lot adopts the orientation of its nearest region) so pins painted
 * outside the lot still read on the grid. Each cell is labelled with the exact percentage mix of
 * intent types within it (supersampled, the same isolated-field math the serializer uses).
 */

type Pt = { x: number; y: number }
type Frame = { dirA: Pt; dirB: Pt; anchor: Pt; cx: number; cy: number }

const CELL = 56 // cell size in world units
const MIN_TOTAL = 0.15 // only label cells with meaningful field (matches VIS_THRESHOLD)
const MIN_PCT = 0.01 // hide negligible (<1%) contributions
const SAMPLES = 3 // NxN supersamples per cell
const LINE_Z = 0.18
const LABEL_Z = 0.2

/** Compact single-letter codes for the cell readout. */
const SHORT: Record<IntentType, string> = {
  DENSITY: 'D',
  OPENNESS: 'O',
}

interface CellRow {
  type: IntentType
  pct: number
  color: string
}
interface Cell {
  cx: number
  cy: number
  rows: CellRow[]
}

const dot = (p: Pt, d: Pt) => p.x * d.x + p.y * d.y

/** Average intent mix over an oriented cell (uv-min corner + cell size), supersampled. */
function cellConcentration(uMin: number, vMin: number, dirA: Pt, dirB: Pt, pins: IntentPin[]) {
  const fields = {} as Record<IntentType, number>
  for (const t of INTENT_TYPES) fields[t] = 0
  for (let j = 0; j < SAMPLES; j++) {
    for (let i = 0; i < SAMPLES; i++) {
      const u = uMin + ((i + 0.5) / SAMPLES) * CELL
      const v = vMin + ((j + 0.5) / SAMPLES) * CELL
      const wx = u * dirA.x + v * dirB.x
      const wy = u * dirA.y + v * dirB.y
      for (const t of INTENT_TYPES) fields[t] += evaluatePinField(wx, wy, t, pins)
    }
  }
  const n = SAMPLES * SAMPLES
  let total = 0
  for (const t of INTENT_TYPES) {
    fields[t] /= n
    total += fields[t]
  }
  const mix = {} as Record<IntentType, number>
  for (const t of INTENT_TYPES) mix[t] = total > 0 ? fields[t] / total : 0
  return { total, mix }
}

export function IntentConcentrationGrid({ pins, clip }: { pins: IntentPin[]; clip?: FieldClip | null }) {
  const boundary = useDrawingStore((s) => s.boundary)
  const lotGridSpacing = useDrawingStore((s) => s.lotGridSpacing)
  const seams = useDrawingStore((s) => s.lotGridSeams)

  const data = useMemo(() => {
    const active = pins.filter((p) => p.radius > 0)
    if (active.length === 0) return null

    // Union AABB of all pin fields, clipped to the board page (no spill onto the grey).
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of active) {
      minX = Math.min(minX, p.x - p.radius)
      minY = Math.min(minY, p.y - p.radius)
      maxX = Math.max(maxX, p.x + p.radius)
      maxY = Math.max(maxY, p.y + p.radius)
    }
    if (clip) {
      minX = Math.max(minX, clip.minX)
      minY = Math.max(minY, clip.minY)
      maxX = Math.min(maxX, clip.maxX)
      maxY = Math.min(maxY, clip.maxY)
    }
    if (minX >= maxX || minY >= maxY) return null

    // Oriented frames from the lot's structural grid regions (one per seam-split region); each
    // carries its centroid so cells outside the lot adopt the nearest region's orientation.
    const frameOf = (ori: number, anchor: Pt, ring: Pt[]): Frame => {
      const dirA = { x: Math.cos(ori), y: Math.sin(ori) }
      let cx = 0
      let cy = 0
      for (const p of ring) {
        cx += p.x
        cy += p.y
      }
      return { dirA, dirB: { x: -dirA.y, y: dirA.x }, anchor, cx: cx / ring.length, cy: cy / ring.length }
    }
    let frames: Frame[] = []
    if (boundary && boundary.isClosed !== false && boundary.ring.length >= 3) {
      frames = lotGridRegions(boundary.ring, Math.max(4, lotGridSpacing), seams).map((r) =>
        frameOf(r.ori, r.anchor, r.ring),
      )
    }
    if (frames.length === 0) {
      // No lot yet ⇒ a single grid in the dominant (or world) orientation over the pin extent.
      const dom = boundary && boundary.ring.length >= 3 ? dominantLotOrientation(boundary.ring) : null
      const ori = dom?.ori ?? 0
      const anchor = dom?.anchor ?? { x: minX, y: minY }
      const dirA = { x: Math.cos(ori), y: Math.sin(ori) }
      frames = [{ dirA, dirB: { x: -dirA.y, y: dirA.x }, anchor, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }]
    }

    const cells: Cell[] = []
    const edges: number[] = []
    const corners: Pt[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ]

    for (const f of frames) {
      const { dirA, dirB, anchor } = f
      // uv-bounds of the (clipped) pin extent in this frame.
      let uMin = Infinity
      let uMax = -Infinity
      let vMin = Infinity
      let vMax = -Infinity
      for (const c of corners) {
        const u = dot(c, dirA)
        const v = dot(c, dirB)
        uMin = Math.min(uMin, u)
        uMax = Math.max(uMax, u)
        vMin = Math.min(vMin, v)
        vMax = Math.max(vMax, v)
      }
      // Snap the lattice to the structural-grid phase (anchored at the region's anchor).
      const aU = dot(anchor, dirA)
      const aV = dot(anchor, dirB)
      const u0 = aU + Math.floor((uMin - aU) / CELL) * CELL
      const v0 = aV + Math.floor((vMin - aV) / CELL) * CELL
      const ncols = Math.ceil((uMax - u0) / CELL)
      const nrows = Math.ceil((vMax - v0) / CELL)

      for (let j = 0; j < nrows; j++) {
        for (let i = 0; i < ncols; i++) {
          const cu = u0 + i * CELL
          const cv = v0 + j * CELL
          const wx = (cu + CELL / 2) * dirA.x + (cv + CELL / 2) * dirB.x
          const wy = (cu + CELL / 2) * dirA.y + (cv + CELL / 2) * dirB.y
          if (clip && (wx < clip.minX || wx > clip.maxX || wy < clip.minY || wy > clip.maxY)) continue
          // Each cell belongs to ONE frame (its nearest region centroid) — no duplicates, and the
          // grid extends outward with the nearest region's orientation.
          if (frames.length > 1) {
            let best = f
            let bestD = Infinity
            for (const g of frames) {
              const d = (g.cx - wx) ** 2 + (g.cy - wy) ** 2
              if (d < bestD) {
                bestD = d
                best = g
              }
            }
            if (best !== f) continue
          }

          const conc = cellConcentration(cu, cv, dirA, dirB, active)
          if (conc.total < MIN_TOTAL) continue

          const rows = INTENT_TYPES.map((t) => ({ type: t, pct: conc.mix[t], color: INTENT_META[t].color }))
            .filter((r) => r.pct >= MIN_PCT)
            .sort((a, b) => b.pct - a.pct)
          cells.push({ cx: wx, cy: wy, rows })

          // Oriented rectangle outline (4 edges) from the cell's uv corners.
          const uvW = (u: number, v: number): [number, number] => [
            u * dirA.x + v * dirB.x,
            u * dirA.y + v * dirB.y,
          ]
          const q = [uvW(cu, cv), uvW(cu + CELL, cv), uvW(cu + CELL, cv + CELL), uvW(cu, cv + CELL)]
          for (let k = 0; k < 4; k++) {
            const a = q[k]
            const b = q[(k + 1) % 4]
            edges.push(a[0], a[1], LINE_Z, b[0], b[1], LINE_Z)
          }
        }
      }
    }

    if (cells.length === 0) return null
    return { cells, edges: new Float32Array(edges) }
  }, [pins, clip, boundary, lotGridSpacing, seams])

  if (!data) return null

  return (
    <>
      <lineSegments raycast={() => null} renderOrder={24}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.edges, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#7c8694" transparent opacity={0.55} depthTest={false} toneMapped={false} />
      </lineSegments>

      {data.cells.map((cell, idx) => (
        <Html
          key={idx}
          position={[cell.cx, cell.cy, LABEL_Z]}
          center
          pointerEvents="none"
          style={{ pointerEvents: 'none' }}
          zIndexRange={[7, 0]}
        >
          <div className="intent-cell">
            {cell.rows.map((r) => (
              <div key={r.type} className="intent-cell-row" style={{ color: r.color }}>
                {SHORT[r.type]} {Math.round(r.pct * 100)}%
              </div>
            ))}
          </div>
        </Html>
      ))}
    </>
  )
}
