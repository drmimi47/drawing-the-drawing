import { useMemo } from 'react'
import { useDrawingStore } from '../../store/drawingStore'

/**
 * Blank-sheet background grid (Context substrate = "Blank sheet").
 *
 * Renders a square, triangular, or dot lattice clipped to the page rectangle,
 * sitting just above the white paper (z=-2) and below the page border (z=-1.9).
 * Spacing is in world units; 32 is the urban-planning default block module.
 *
 * Hidden for the Map substrate and for imported underlays (those have their own
 * reference imagery), and skipped entirely for very dense spacings to keep the
 * vertex count bounded.
 */

const SQRT3_2 = Math.sqrt(3) / 2
const GRID_Z = -1.95
const COLOR = '#d8dde6'

/** Liang–Barsky clip of segment (p0→p1) to the rect [-hw,hw]×[-hh,hh]. */
function clipToRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  hw: number,
  hh: number,
): [number, number, number, number] | null {
  const dx = x1 - x0
  const dy = y1 - y0
  let t0 = 0
  let t1 = 1
  const p = [-dx, dx, -dy, dy]
  const q = [x0 + hw, hw - x0, y0 + hh, hh - y0]
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null // parallel and outside
    } else {
      const r = q[i] / p[i]
      if (p[i] < 0) {
        if (r > t1) return null
        if (r > t0) t0 = r
      } else {
        if (r < t0) return null
        if (r < t1) t1 = r
      }
    }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy]
}

/** Append a family of parallel lines (perpendicular spacing `d`) clipped to rect. */
function pushFamily(angleDeg: number, d: number, hw: number, hh: number, out: number[]) {
  const a = (angleDeg * Math.PI) / 180
  const dir = [Math.cos(a), Math.sin(a)]
  const nrm = [-Math.sin(a), Math.cos(a)]
  const halfProj = Math.abs(hw * nrm[0]) + Math.abs(hh * nrm[1])
  const kMax = Math.ceil(halfProj / d)
  const span = (hw + hh) * 2 // long enough to cross the page at any angle
  for (let k = -kMax; k <= kMax; k++) {
    const c = k * d
    const bx = c * nrm[0]
    const by = c * nrm[1]
    const seg = clipToRect(bx - dir[0] * span, by - dir[1] * span, bx + dir[0] * span, by + dir[1] * span, hw, hh)
    if (seg) out.push(seg[0], seg[1], GRID_Z, seg[2], seg[3], GRID_Z)
  }
}

export function GridView() {
  const context = useDrawingStore((s) => s.context)
  const underlay = useDrawingStore((s) => s.underlay)
  const gridType = useDrawingStore((s) => s.gridType)
  const spacing = useDrawingStore((s) => s.gridSpacing)
  const width = useDrawingStore((s) => s.pageWidth)
  const height = useDrawingStore((s) => s.pageHeight)

  const { lines, dots } = useMemo(() => {
    const hw = width / 2
    const hh = height / 2
    // Guard against pathological vertex counts on tiny spacing.
    const safe = Math.max(spacing, Math.max(width, height) / 4000)

    if (gridType === 'dots') {
      const pts: number[] = []
      const ni = Math.floor(hw / safe)
      const nj = Math.floor(hh / safe)
      for (let i = -ni; i <= ni; i++) {
        for (let j = -nj; j <= nj; j++) {
          pts.push(i * safe, j * safe, GRID_Z)
        }
      }
      return { lines: null, dots: new Float32Array(pts) }
    }

    const seg: number[] = []
    if (gridType === 'triangle') {
      // Equilateral tiling: three families 60° apart, perpendicular spacing s·√3/2.
      const d = safe * SQRT3_2
      pushFamily(0, d, hw, hh, seg)
      pushFamily(60, d, hw, hh, seg)
      pushFamily(120, d, hw, hh, seg)
    } else {
      // Square: horizontal + vertical families at the raw spacing.
      pushFamily(0, safe, hw, hh, seg)
      pushFamily(90, safe, hw, hh, seg)
    }
    return { lines: new Float32Array(seg), dots: null }
  }, [gridType, spacing, width, height])

  if (context !== 'BLANK' || underlay || gridType === 'none') return null

  if (dots) {
    return (
      <points renderOrder={-9} raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dots, 3]} />
        </bufferGeometry>
        <pointsMaterial color={COLOR} size={2.4} sizeAttenuation={false} toneMapped={false} />
      </points>
    )
  }

  return (
    <lineSegments renderOrder={-9} raycast={() => null}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[lines!, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={COLOR} toneMapped={false} />
    </lineSegments>
  )
}
