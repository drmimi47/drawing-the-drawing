import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import { INTENT_META, INTENT_TYPES, type IntentPin, type IntentType } from '../../types/geometry'
import { getRegionConcentration } from '../../utils/metaballField'

/**
 * Intent concentration grid (hover preview over the Intent Pin button).
 *
 * Discretizes the region around the pins into fixed world-space cells and labels
 * each cell with the EXACT percentage mix of intent types within it. The numbers
 * come from getRegionConcentration — the same isolated-field math that feeds the
 * Phase-2 serializer — supersampled per cell so each reads the true area-weighted
 * composition of that region (not a single point, not pseudo data). This lets the
 * user see the discrete mix the LLM will pull from, beyond the smooth gradient.
 *
 * Cell outlines are drawn in WebGL (world space, so they track pan/zoom); the
 * percentage readouts are DOM labels (drei Html) for crisp text at any zoom.
 */

const CELL = 56 // region cell size in world units
const MIN_TOTAL = 0.15 // only label cells with meaningful field (matches VIS_THRESHOLD)
const MIN_PCT = 0.01 // hide negligible (<1%) contributions
const LINE_Z = 0.18
const LABEL_Z = 0.2

/** Compact single-letter codes for the cell readout. */
const SHORT: Record<IntentType, string> = {
  DENSITY: 'D',
  PEDESTRIAN: 'P',
  SQF: 'S',
  LANDUSE: 'L',
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

export function IntentConcentrationGrid({ pins }: { pins: IntentPin[] }) {
  const data = useMemo(() => {
    const active = pins.filter((p) => p.radius > 0)
    if (active.length === 0) return null

    // Union AABB of all pin fields.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of active) {
      if (p.x - p.radius < minX) minX = p.x - p.radius
      if (p.y - p.radius < minY) minY = p.y - p.radius
      if (p.x + p.radius > maxX) maxX = p.x + p.radius
      if (p.y + p.radius > maxY) maxY = p.y + p.radius
    }

    // Snap the grid origin to the cell lattice so cells are stable as pins move.
    const x0 = Math.floor(minX / CELL) * CELL
    const y0 = Math.floor(minY / CELL) * CELL
    const cols = Math.ceil((maxX - x0) / CELL)
    const rows = Math.ceil((maxY - y0) / CELL)

    const cells: Cell[] = []
    const edges: number[] = [] // line segments for active-cell outlines

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const cellMinX = x0 + i * CELL
        const cellMinY = y0 + j * CELL
        const cellMaxX = cellMinX + CELL
        const cellMaxY = cellMinY + CELL

        const c = getRegionConcentration(cellMinX, cellMinY, cellMaxX, cellMaxY, active)
        if (c.total < MIN_TOTAL) continue

        const cellRows: CellRow[] = INTENT_TYPES.map((t) => ({
          type: t,
          pct: c.mix[t],
          color: INTENT_META[t].color,
        }))
          .filter((r) => r.pct >= MIN_PCT)
          .sort((a, b) => b.pct - a.pct)

        cells.push({ cx: cellMinX + CELL / 2, cy: cellMinY + CELL / 2, rows: cellRows })

        // Rectangle outline (4 edges) for this active cell.
        const corners = [
          [cellMinX, cellMinY],
          [cellMaxX, cellMinY],
          [cellMaxX, cellMaxY],
          [cellMinX, cellMaxY],
        ]
        for (let k = 0; k < 4; k++) {
          const a = corners[k]
          const b = corners[(k + 1) % 4]
          edges.push(a[0], a[1], LINE_Z, b[0], b[1], LINE_Z)
        }
      }
    }

    if (cells.length === 0) return null
    return { cells, edges: new Float32Array(edges) }
  }, [pins])

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
