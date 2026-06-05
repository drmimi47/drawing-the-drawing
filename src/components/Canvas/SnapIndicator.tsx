import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SnapPoint } from '../../geometry/spatialIndex'

/**
 * Snap-target indicator (Cluster 3). Drawn as a small outline at the active snap
 * point — a SQUARE for a vertex/endpoint, a TRIANGLE for an edge midpoint (the
 * standard CAD object-snap glyphs). Sized in screen pixels: a unit shape is built
 * once and rescaled by 1/zoom each frame so it stays a constant size on screen at
 * any zoom level. Sits above all geometry and ignores depth so it's never hidden.
 */

const HALF_PX = 6 // half-extent of the glyph, in screen pixels
const COLOR = '#1f2937'
const GLYPH_Z = 5

// Unit (half-extent = 1) outlines as lineLoop vertices (auto-closed).
const SQUARE = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])
const TRIANGLE = new Float32Array([0, 1.15, 0, 1, -0.78, 0, -1, -0.78, 0])

export function SnapIndicator({ snap }: { snap: SnapPoint }) {
  const ref = useRef<THREE.LineLoop>(null)

  const geometry = useMemo(() => {
    const verts = snap.kind === 'MIDPOINT' ? TRIANGLE : SQUARE
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    return g
  }, [snap.kind])

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state) => {
    const line = ref.current
    if (!line) return
    const zoom = (state.camera as THREE.OrthographicCamera).zoom || 1
    const s = HALF_PX / zoom
    line.position.set(snap.x, snap.y, GLYPH_Z)
    line.scale.set(s, s, 1)
  })

  return (
    <lineLoop ref={ref} geometry={geometry} renderOrder={40} frustumCulled={false}>
      <lineBasicMaterial color={COLOR} depthTest={false} transparent toneMapped={false} />
    </lineLoop>
  )
}
