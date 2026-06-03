import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useDrawingStore, type Underlay } from '../../store/drawingStore'

/**
 * Read-only tracing underlay: the imported PDF page / image, dimmed, placed on
 * the world grid via its OWN transform (centered rect, aspect-preserved) — it no
 * longer fills the page sheet, so the page frame stays an independent coordinate
 * system. It sits above the white paper but below the page border, the lock/intent
 * fields, and all strokes, and never receives raycasts — purely a backdrop to
 * trace over that can't be edited or selected.
 */
export function UnderlayView({ underlay: explicit }: { underlay?: Underlay | null } = {}) {
  // Active board reads the live underlay; a neighbor board passes its own (which may
  // be null). `undefined` means "not provided" → fall back to the store.
  const storeUnderlay = useDrawingStore((s) => s.underlay)
  const underlay = explicit !== undefined ? explicit : storeUnderlay

  const texture = useMemo(() => {
    if (!underlay) return null
    const tex = new THREE.TextureLoader().load(underlay.src)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    return tex
  }, [underlay])

  useEffect(() => () => texture?.dispose(), [texture])

  if (!underlay || !texture) return null

  return (
    <mesh position={[underlay.x, underlay.y, -1.8]} renderOrder={-8} raycast={() => null}>
      <planeGeometry args={[underlay.width, underlay.height]} />
      <meshBasicMaterial map={texture} transparent opacity={underlay.opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}
