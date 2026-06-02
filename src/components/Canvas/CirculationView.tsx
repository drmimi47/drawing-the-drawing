import { useMemo } from 'react'
import * as THREE from 'three'
import { useDrawingStore } from '../../store/drawingStore'
import type { CirculationPath } from '../../types/geometry'
import { buildStrokeGeometry } from './strokeGeometry'

/**
 * Circulation corridor bands (Bloom restructure — Stage 2). Each hallway
 * centerline is rendered as a translucent filled band at its corridor width
 * (reusing the straight-polyline ribbon builder), so it reads as a keep-out
 * strip that department fields will avoid. Locked corridors render in slate.
 */

const FILL_COLOR = '#64748b'        // active corridor (slate)
const FILL_LOCKED = '#475569'       // locked corridor (darker slate)
const BAND_OPACITY = 0.3
const Z = 2 // above strokes (1), below the boundary frame (5) and overlays (6)

function CorridorBand({ path }: { path: CirculationPath }) {
  const geometry = useMemo(
    () =>
      buildStrokeGeometry(
        path.centerline.map((p) => ({ x: p.x, y: p.y, w: path.width / 2 })),
        true,
        'solid',
        path.width,
      ),
    [path],
  )

  if (!geometry.positions || !geometry.indices) return null

  return (
    // frustumCulled off: the geometry is rebuilt only on edit, so its (lazily
    // cached) bounding sphere would otherwise go stale and cull when zoomed in.
    <mesh raycast={() => null} renderOrder={2} frustumCulled={false} position={[0, 0, Z]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
        <bufferAttribute attach="index" args={[geometry.indices, 1]} />
      </bufferGeometry>
      <meshBasicMaterial
        color={path.isLocked ? FILL_LOCKED : FILL_COLOR}
        transparent
        opacity={BAND_OPACITY}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

export function CirculationView() {
  const paths = useDrawingStore((s) => s.circulationPaths)
  return (
    <>
      {paths.map((p) => (
        <CorridorBand key={p.id} path={p} />
      ))}
    </>
  )
}
