import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { LockPolygon } from '../../types/geometry'
import { lockInfluenceAt } from '../../geometry/locks'

/**
 * Lock-region visualization (Cluster H, H4 — distance-field gradient).
 *
 * The fill opacity is driven by the lock INFLUENCE field (the same function that
 * gates Clean up): darkest in the hard-locked core, fading smoothly to
 * transparent at the boundary. Overlapping locks union via max(influence).
 *
 * Implemented by baking the field into a DataTexture over the locks' bounding
 * box and sampling it as the material's alpha (white rgb, red material color).
 * Rebakes only when the locks change. Sits behind strokes (z = -0.5).
 */

const LOCK_COLOR = new THREE.Color('#e23b3b')
const MAX_OPACITY = 0.5
const MAX_TEXELS = 256
const MARGIN = 8 // world-unit padding so the edge fade resolves cleanly

interface Field {
  texture: THREE.DataTexture
  cx: number
  cy: number
  w: number
  h: number
}

export function LockFieldView({ locks }: { locks: LockPolygon[] }) {
  const field = useMemo<Field | null>(() => {
    if (locks.length === 0) return null

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const lock of locks) {
      for (const p of lock.points) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
    }
    minX -= MARGIN
    minY -= MARGIN
    maxX += MARGIN
    maxY += MARGIN
    const w = maxX - minX
    const h = maxY - minY
    if (w <= 0 || h <= 0) return null

    const longest = Math.max(w, h)
    const cols = Math.max(2, Math.min(MAX_TEXELS, Math.ceil((w / longest) * MAX_TEXELS)))
    const rows = Math.max(2, Math.min(MAX_TEXELS, Math.ceil((h / longest) * MAX_TEXELS)))

    const data = new Uint8Array(cols * rows * 4)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const wx = minX + ((i + 0.5) / cols) * w
        const wy = minY + ((j + 0.5) / rows) * h
        const influence = lockInfluenceAt(wx, wy, locks) // 0..1, max across locks
        const idx = (j * cols + i) * 4
        data[idx] = 255
        data[idx + 1] = 255
        data[idx + 2] = 255
        data[idx + 3] = Math.round(influence * 255)
      }
    }

    const texture = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true

    return { texture, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w, h }
  }, [locks])

  useEffect(() => {
    return () => {
      field?.texture.dispose()
    }
  }, [field])

  if (!field) return null

  return (
    <mesh position={[field.cx, field.cy, -0.5]} raycast={() => null} renderOrder={-2}>
      <planeGeometry args={[field.w, field.h]} />
      <meshBasicMaterial map={field.texture} color={LOCK_COLOR} transparent opacity={MAX_OPACITY} depthWrite={false} />
    </mesh>
  )
}
