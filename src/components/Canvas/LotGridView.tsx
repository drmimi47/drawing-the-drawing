import { useMemo } from 'react'
import { useDrawingStore } from '../../store/drawingStore'
import { buildLotGrid } from '../../geometry/lotGrid'

/**
 * Structural grid inside the closed lot (Boundary layer). By default ONE best-fit grid;
 * the user adds splits by drawing SEAMS (open polylines with the Polyline tool), each of
 * which divides the lot into regions that get their own best-fit grid. Seams are drawn as
 * a slightly stronger line so the user can see the split. A light monochrome guide that
 * feeds orientation-aware room generation.
 */

const GRID_Z = 0.08
const SEAM_Z = 0.1
const GRID_COLOR = '#9aa3af'
const SEAM_COLOR = '#5b6573'

export function LotGridView() {
  const activeLayer = useDrawingStore((s) => s.activeLayer)
  const boundary = useDrawingStore((s) => s.boundary)
  const visible = useDrawingStore((s) => s.lotGridVisible)
  const spacing = useDrawingStore((s) => s.lotGridSpacing)
  const seams = useDrawingStore((s) => s.lotGridSeams)

  const gridPositions = useMemo(() => {
    if (!boundary || boundary.isClosed === false || boundary.ring.length < 3) return null
    const sets = buildLotGrid(boundary.ring, spacing, seams)
    let count = 0
    for (const s of sets) count += s.segments.length
    if (count === 0) return null
    const arr = new Float32Array(count * 6)
    let i = 0
    for (const set of sets) {
      for (const [a, b] of set.segments) {
        arr[i++] = a.x
        arr[i++] = a.y
        arr[i++] = GRID_Z
        arr[i++] = b.x
        arr[i++] = b.y
        arr[i++] = GRID_Z
      }
    }
    return arr
  }, [boundary, spacing, seams])

  // Seam lines themselves (so the user sees where the grid splits).
  const seamPositions = useMemo(() => {
    let count = 0
    for (const s of seams) count += Math.max(0, s.length - 1)
    if (count === 0) return null
    const arr = new Float32Array(count * 6)
    let i = 0
    for (const s of seams) {
      for (let k = 0; k + 1 < s.length; k++) {
        arr[i++] = s[k].x
        arr[i++] = s[k].y
        arr[i++] = SEAM_Z
        arr[i++] = s[k + 1].x
        arr[i++] = s[k + 1].y
        arr[i++] = SEAM_Z
      }
    }
    return arr
  }, [seams])

  // Shown (when toggled on) on every layer that builds on the lot grid: Boundary (where it's
  // built), Circulation (trace along it), Departments (organize against it), and Rooms (see how
  // rooms match it). Hidden in Context/Intent/Generate.
  const onGridLayer =
    activeLayer === 'BOUNDARY' ||
    activeLayer === 'CIRCULATION' ||
    activeLayer === 'DEPARTMENTS' ||
    activeLayer === 'ROOMS'
  if (!onGridLayer || !visible) return null

  return (
    <>
      {gridPositions && (
        <lineSegments raycast={() => null} renderOrder={2} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[gridPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={GRID_COLOR} transparent opacity={0.5} depthTest={false} toneMapped={false} />
        </lineSegments>
      )}
      {seamPositions && (
        <lineSegments raycast={() => null} renderOrder={3} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[seamPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={SEAM_COLOR} transparent opacity={0.9} depthTest={false} toneMapped={false} />
        </lineSegments>
      )}
    </>
  )
}
