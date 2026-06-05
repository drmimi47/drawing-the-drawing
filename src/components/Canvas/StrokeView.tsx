import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { resolveStrokePoints } from '../../geometry/graph'
import type { Graph, LineStyle, SamplePoint, Stroke } from '../../types/geometry'
import { buildStrokeGeometry } from './strokeGeometry'

/**
 * Shared stroke rendering primitives.
 *
 * Extracted from DrawingLayer so the read-only neighbor-canvas renderer
 * (InactiveCanvases) can draw committed graph strokes with identical geometry,
 * without pulling in the live tool hooks DrawingLayer wires up.
 */

export const SELECTION_COLOR = '#1f2937'

/**
 * A ribbon for a centerline polyline (smoothed unless `straight`), honoring the
 * stroke's drafting line style. Width falls back to 2× the first half-width when
 * `strokeWidth` is absent (older strokes / live previews).
 */
export function RibbonMesh({
  points,
  color,
  straight,
  lineStyle,
  strokeWidth,
  onTop,
}: {
  points: SamplePoint[]
  color: string
  straight?: boolean
  lineStyle?: LineStyle
  strokeWidth?: number
  /** Draw above the lot-boundary fill/outline (used for the live polyline preview). */
  onTop?: boolean
}) {
  const width = strokeWidth ?? (points.length > 0 ? points[0].w * 2 : 2)
  const geometry = useMemo(
    () => buildStrokeGeometry(points, straight, lineStyle, width),
    [points, straight, lineStyle, width],
  )

  // The BufferGeometry instance is reused as `geometry` data updates (live draw /
  // polyline preview / vertex drag). Three.js caches the bounding sphere on first
  // cull and never refreshes it, so a moving preview keeps a stale sphere and gets
  // wrongly frustum-culled when zoomed in (small frustum). Recompute it on every
  // geometry change so culling stays correct without disabling it scene-wide.
  const geoRef = useRef<THREE.BufferGeometry>(null)
  useLayoutEffect(() => {
    const g = geoRef.current
    if (g && geometry.positions) g.computeBoundingSphere()
  }, [geometry])

  if (!geometry.positions || !geometry.indices) return null

  return (
    <mesh raycast={() => null} renderOrder={onTop ? 26 : 1} position={[0, 0, onTop ? 9 : 0]}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
        <bufferAttribute attach="index" args={[geometry.indices, 1]} />
      </bufferGeometry>
      <meshBasicMaterial color={color} side={THREE.DoubleSide} toneMapped={false} depthTest={!onTop} transparent={onTop} />
    </mesh>
  )
}

/** Resolve a graph stroke to centerline points and render it (tinted when selected). */
export function StrokeView({ graph, stroke, selected }: { graph: Graph; stroke: Stroke; selected: boolean }) {
  const points = useMemo(() => resolveStrokePoints(graph, stroke), [graph, stroke])
  return (
    <RibbonMesh
      points={points}
      color={selected ? SELECTION_COLOR : stroke.color}
      straight={stroke.straight}
      lineStyle={stroke.lineStyle}
      strokeWidth={stroke.strokeWidth}
    />
  )
}
