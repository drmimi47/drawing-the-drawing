import { useMemo } from 'react'
import * as THREE from 'three'
import type { LockPolygon } from '../../types/geometry'
import { buildRibbon } from './strokeGeometry'

/**
 * Lock-region visualization (Cluster H, H4). Communicates the hard + feathered
 * zones without a per-pixel distance-field shader:
 *   - hard fill   : translucent filled polygon (frozen core)
 *   - feather halo : a soft band of width featherRadius hugging the boundary
 *   - border       : a crisp outline
 */

const LOCK_COLOR = '#e23b3b'

function LockField({ poly }: { poly: LockPolygon }) {
  const shape = useMemo(
    () => new THREE.Shape(poly.points.map((p) => new THREE.Vector2(p.x, p.y))),
    [poly.points],
  )

  const border = useMemo(() => {
    const a = new Float32Array(poly.points.length * 3)
    poly.points.forEach((p, i) => {
      a[i * 3] = p.x
      a[i * 3 + 1] = p.y
      a[i * 3 + 2] = 0.5
    })
    return a
  }, [poly.points])

  // Soft halo: a ribbon centered on the boundary, half-width = featherRadius,
  // so it spans featherRadius inward and outward (the negotiation zone).
  const feather = useMemo(() => {
    const loop = [...poly.points, poly.points[0]].map((p) => ({ x: p.x, y: p.y, w: poly.featherRadius }))
    return buildRibbon(loop)
  }, [poly.points, poly.featherRadius])

  return (
    <group>
      {feather.positions && feather.indices && (
        <mesh raycast={() => null} renderOrder={0}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[feather.positions, 3]} />
            <bufferAttribute attach="index" args={[feather.indices, 1]} />
          </bufferGeometry>
          <meshBasicMaterial color={LOCK_COLOR} transparent opacity={0.1} depthWrite={false} />
        </mesh>
      )}
      <mesh position={[0, 0, -0.5]} raycast={() => null} renderOrder={0}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color={LOCK_COLOR} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <lineLoop raycast={() => null} renderOrder={2}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[border, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={LOCK_COLOR} transparent opacity={0.85} depthTest={false} />
      </lineLoop>
    </group>
  )
}

export function LockFieldView({ locks }: { locks: LockPolygon[] }) {
  return (
    <>
      {locks.map((poly) => (
        <LockField key={poly.id} poly={poly} />
      ))}
    </>
  )
}
