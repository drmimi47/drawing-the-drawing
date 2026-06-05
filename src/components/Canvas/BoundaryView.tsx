import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useDrawingStore } from '../../store/drawingStore'

/**
 * Lot boundary (Gradia restructure — Stage 1). Renders store.boundary as a closed
 * loop in world space — the master working frame ("a canvas within the canvas") —
 * plus a translucent interior fill whose opacity is user-controlled (INFILL
 * OPACITY slider).
 *
 * When the segment eraser opens the ring (isClosed === false) it renders as an
 * OPEN red chain with no fill, signalling the lot must be re-closed before the
 * downstream layers unlock.
 */

const BOUNDARY_COLOR = '#111111' // boundary border (black)
const BOUNDARY_OPEN_COLOR = '#dc2626' // incomplete (open) boundary (red warning)
const BOUNDARY_FILL_COLOR = '#ffffff' // white interior infill
const BOUNDARY_WIDTH = 2 // px — matches the magenta context reference outline's stroke width
const Z = 5 // above strokes (1), below CAD snap overlays (6)

export function BoundaryView() {
  const boundary = useDrawingStore((s) => s.boundary)
  const infillOpacity = useDrawingStore((s) => s.boundaryInfillOpacity)
  const activeLayer = useDrawingStore((s) => s.activeLayer)

  const isClosed = boundary?.isClosed !== false

  // Thick line points (drei <Line> draws a screen-space-width polyline). Closed ⇒ repeat the
  // first vertex to close the loop; open chain ⇒ the path as-is (no closing edge).
  const linePoints = useMemo<[number, number, number][] | null>(() => {
    if (!boundary || boundary.ring.length < 2) return null
    const pts = boundary.ring.map((p) => [p.x, p.y, Z] as [number, number, number])
    if (isClosed) pts.push([boundary.ring[0].x, boundary.ring[0].y, Z])
    return pts
  }, [boundary, isClosed])

  // Triangulated interior (earcut via THREE.Shape) — only for a closed ring.
  const shape = useMemo(() => {
    if (!boundary || !isClosed || boundary.ring.length < 3) return null
    return new THREE.Shape(boundary.ring.map((p) => new THREE.Vector2(p.x, p.y)))
  }, [boundary, isClosed])

  if (!linePoints) return null

  // In the Context layer the boundary is shown as a screen-space magenta reference
  // outline (BoundaryContextOverlay) drawn ABOVE the live map, so the R3F view —
  // which the map would otherwise hide — renders nothing here.
  if (activeLayer === 'CONTEXT') return null

  const color = !isClosed ? BOUNDARY_OPEN_COLOR : BOUNDARY_COLOR

  return (
    // key so a redraw with a different point count / closed-state remounts cleanly.
    <group key={`${linePoints.length}-${isClosed}`}>
      {shape && infillOpacity > 0 && (
        <mesh position={[0, 0, Z - 0.1]} renderOrder={19} frustumCulled={false}>
          <shapeGeometry args={[shape]} />
          <meshBasicMaterial
            color={BOUNDARY_FILL_COLOR}
            transparent
            opacity={infillOpacity}
            depthTest={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* drei <Line> = a screen-space-width polyline (BOUNDARY_WIDTH px), so the black lot edge
          is as thick as the magenta context reference. renderOrder 28 sorts it ABOVE the fill
          (19) and the department gradient (26), so the edge stays a crisp outline. */}
      <Line
        points={linePoints}
        color={color}
        lineWidth={BOUNDARY_WIDTH}
        transparent
        depthTest={false}
        toneMapped={false}
        renderOrder={28}
        frustumCulled={false}
      />
    </group>
  )
}
