import { useMemo } from 'react'
import { useDrawingStore } from '../../store/drawingStore'

/**
 * Lot boundary outline (Bloom restructure — Stage 1). Renders store.boundary as a
 * closed loop in world space — the master working frame ("a canvas within the
 * canvas"). A locked boundary is drawn in a desaturated tone to read as frozen.
 */

const BOUNDARY_COLOR = '#2563eb'      // active boundary (blue)
const BOUNDARY_LOCKED_COLOR = '#64748b' // locked boundary (slate)
const Z = 5 // above strokes (1), below CAD snap overlays (6)

export function BoundaryView() {
  const boundary = useDrawingStore((s) => s.boundary)

  const positions = useMemo(() => {
    if (!boundary || boundary.ring.length < 3) return null
    const arr = new Float32Array(boundary.ring.length * 3)
    boundary.ring.forEach((p, i) => {
      arr[i * 3] = p.x
      arr[i * 3 + 1] = p.y
      arr[i * 3 + 2] = Z
    })
    return arr
  }, [boundary])

  if (!positions) return null

  return (
    // key on vertex count so a redraw with a different point count remounts cleanly.
    <lineLoop key={positions.length} renderOrder={20} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={boundary?.isLocked ? BOUNDARY_LOCKED_COLOR : BOUNDARY_COLOR}
        depthTest={false}
        toneMapped={false}
      />
    </lineLoop>
  )
}
