import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useDrawingStore } from '../../store/drawingStore'
import { DashedGuideLine, GLYPH_HALF_PX, GUIDE_Z } from './SnapGuideOverlay'

/**
 * Object-snap tracking (O-TRACK) overlay for the Polyline tool.
 *
 * Reads the transient `store.trackedPoints` (anchors acquired by hovering a
 * vertex/midpoint ~400ms) and renders:
 *   - a small light-gray ✛ at every acquired anchor (acquisition confirmation), and
 *   - a thin gray dashed alignment ray from each anchor that is axis-aligned with
 *     the currently-locked cursor (guide type 'tracking'); with two anchors this
 *     shows both the vertical and horizontal traces meeting at their intersection.
 *
 * Polyline-only: mounted by DrawingLayer behind a `toolMode === 'POLYLINE'` gate.
 */

/** Tracking cues use a muted gray so they read as construction aids, not geometry. */
const COLOR_TRACK = '#94a3b8'

/** Anchor marker ✛ — horizontal + vertical bar (unit scale, drawn as segments). */
const PLUS_PTS = new Float32Array([
  -1, 0, 0,   1, 0, 0,    // horizontal bar
  0, -1, 0,   0, 1, 0,    // vertical bar
])

/** Two world coords are "axis-aligned" if they coincide (the lock sets them equal). */
const ALIGN_EPS = 1e-4

function PlusGlyph({ position }: { position: [number, number] }) {
  const lineObj = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(PLUS_PTS, 3))
    const mat = new THREE.LineBasicMaterial({ color: COLOR_TRACK, depthTest: false, toneMapped: false })
    const obj = new THREE.LineSegments(g, mat)
    obj.renderOrder = 36
    obj.frustumCulled = false
    return obj
  }, [])

  useEffect(() => () => {
    lineObj.geometry.dispose()
    ;(lineObj.material as THREE.Material).dispose()
  }, [lineObj])

  useFrame((state) => {
    const zoom = (state.camera as THREE.OrthographicCamera).zoom || 1
    const s = GLYPH_HALF_PX / zoom
    lineObj.position.set(position[0], position[1], GUIDE_Z)
    lineObj.scale.set(s, s, 1)
  })

  return <primitive object={lineObj} />
}

export function TrackingOverlay() {
  const trackedPoints = useDrawingStore((s) => s.trackedPoints)
  const guide = useDrawingStore((s) => s.activeSnapGuide)
  const snappingEnabled = useDrawingStore((s) => s.snappingEnabled)

  if (!snappingEnabled || trackedPoints.length === 0) return null

  // The locked cursor (only while a tracking alignment is active).
  const cursor = guide && guide.type === 'tracking' ? guide.toPoint : null

  return (
    <>
      {trackedPoints.map((p) => (
        <PlusGlyph key={p.id} position={p.coords} />
      ))}
      {cursor &&
        trackedPoints.map((p) => {
          const aligned =
            Math.abs(p.coords[0] - cursor[0]) < ALIGN_EPS || Math.abs(p.coords[1] - cursor[1]) < ALIGN_EPS
          if (!aligned) return null
          return <DashedGuideLine key={`ray-${p.id}`} from={p.coords} to={cursor} color={COLOR_TRACK} />
        })}
    </>
  )
}
