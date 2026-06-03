import { useMemo } from 'react'
import * as THREE from 'three'
import { useDrawingStore } from '../../store/drawingStore'

/**
 * Lot boundary (Gradia Draw restructure — Stage 1). Renders store.boundary as a closed
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
const Z = 5 // above strokes (1), below CAD snap overlays (6)

export function BoundaryView() {
  const boundary = useDrawingStore((s) => s.boundary)
  const infillOpacity = useDrawingStore((s) => s.boundaryInfillOpacity)
  const activeLayer = useDrawingStore((s) => s.activeLayer)

  const isClosed = boundary?.isClosed !== false

  // Closed loop ⇒ one position per vertex (lineLoop closes it). Open chain ⇒
  // consecutive segment pairs for <lineSegments> (no closing edge).
  const linePositions = useMemo(() => {
    if (!boundary || boundary.ring.length < 2) return null
    const ring = boundary.ring
    if (isClosed) {
      const arr = new Float32Array(ring.length * 3)
      ring.forEach((p, i) => {
        arr[i * 3] = p.x
        arr[i * 3 + 1] = p.y
        arr[i * 3 + 2] = Z
      })
      return arr
    }
    const arr = new Float32Array((ring.length - 1) * 6)
    for (let i = 0; i < ring.length - 1; i++) {
      arr.set([ring[i].x, ring[i].y, Z, ring[i + 1].x, ring[i + 1].y, Z], i * 6)
    }
    return arr
  }, [boundary, isClosed])

  // Triangulated interior (earcut via THREE.Shape) — only for a closed ring.
  const shape = useMemo(() => {
    if (!boundary || !isClosed || boundary.ring.length < 3) return null
    return new THREE.Shape(boundary.ring.map((p) => new THREE.Vector2(p.x, p.y)))
  }, [boundary, isClosed])

  if (!linePositions) return null

  // In the Context layer the boundary is shown as a screen-space magenta reference
  // outline (BoundaryContextOverlay) drawn ABOVE the live map, so the R3F view —
  // which the map would otherwise hide — renders nothing here.
  if (activeLayer === 'CONTEXT') return null

  const color = !isClosed ? BOUNDARY_OPEN_COLOR : BOUNDARY_COLOR

  return (
    // key so a redraw with a different point count / closed-state remounts cleanly.
    <group key={`${linePositions.length}-${isClosed}`}>
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

      {isClosed ? (
        <lineLoop renderOrder={20} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          </bufferGeometry>
          {/* transparent so it joins the transparent pass and sorts ABOVE the fill
              (renderOrder 20 > 19) — keeps the border visible at any infill %. */}
          <lineBasicMaterial color={color} depthTest={false} transparent toneMapped={false} />
        </lineLoop>
      ) : (
        <lineSegments renderOrder={20} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={color} depthTest={false} transparent toneMapped={false} />
        </lineSegments>
      )}
    </group>
  )
}
