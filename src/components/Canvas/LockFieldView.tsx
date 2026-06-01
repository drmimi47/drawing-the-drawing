import { useMemo } from 'react'
import * as THREE from 'three'
import type { LockPolygon } from '../../types/geometry'

/**
 * Lock-region visualization (Cluster H, H4 — simplified).
 *
 * A flat transparent-red infill of the lock regions. Overlapping locks JOIN into
 * one uniform region (no darker intersection) using the stencil buffer: each
 * polygon writes 1 into the stencil (color off), then a single translucent quad
 * fills wherever the stencil is set — so each unioned pixel is painted exactly
 * once. The fill sits behind strokes (depth-tested at z = -0.5).
 */

const LOCK_COLOR = '#e23b3b'
const FILL_OPACITY = 0.2
const STENCIL_REF = 1

function LockMask({ poly }: { poly: LockPolygon }) {
  const shape = useMemo(
    () => new THREE.Shape(poly.points.map((p) => new THREE.Vector2(p.x, p.y))),
    [poly.points],
  )
  return (
    <mesh raycast={() => null} renderOrder={-3}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial
        colorWrite={false}
        depthWrite={false}
        depthTest={false}
        stencilWrite
        stencilRef={STENCIL_REF}
        stencilFunc={THREE.AlwaysStencilFunc}
        stencilZPass={THREE.ReplaceStencilOp}
      />
    </mesh>
  )
}

export function LockFieldView({ locks }: { locks: LockPolygon[] }) {
  if (locks.length === 0) return null

  return (
    <group>
      {locks.map((poly) => (
        <LockMask key={poly.id} poly={poly} />
      ))}

      {/* Single translucent fill, clipped to the unioned stencil mask. */}
      <mesh position={[0, 0, -0.5]} raycast={() => null} renderOrder={-2}>
        <planeGeometry args={[1_000_000, 1_000_000]} />
        <meshBasicMaterial
          color={LOCK_COLOR}
          transparent
          opacity={FILL_OPACITY}
          depthWrite={false}
          stencilWrite
          stencilRef={STENCIL_REF}
          stencilFunc={THREE.EqualStencilFunc}
        />
      </mesh>
    </group>
  )
}
