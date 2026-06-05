import { useMemo } from 'react'
import { useDrawingStore } from '../../store/drawingStore'

/**
 * The document "sheet": a fixed-size white page centered at the world origin.
 * Defaults to a 3:2 landscape (ARCH-D-like) artboard, but resizes to match an
 * imported PDF/image underlay (Cluster K).
 *
 * It is purely visual — it renders behind every drawing/field layer and never
 * receives raycasts, so the world-space coordinate logic is unaffected. The
 * surrounding workspace is the dark GL clear color set on the <Canvas>.
 */
export function PageSheet() {
  const width = useDrawingStore((s) => s.pageWidth)
  const height = useDrawingStore((s) => s.pageHeight)
  const context = useDrawingStore((s) => s.context)
  // When more than one design-option canvas exists, accent the ACTIVE sheet's border
  // so the editable canvas reads as distinct from its read-only neighbors.
  const multiCanvas = useDrawingStore((s) => s.canvases.length > 1)
  const borderColor = multiCanvas ? '#1f2937' : '#c0c6cf'
  // In MAP context the dimmed Mapbox underlay fills the artboard, so we skip the
  // opaque white fill (the transparent canvas lets the map show through). The page
  // border still draws as a frame.
  const showPaper = context !== 'MAP'

  // Outline as a closed loop of the four page corners.
  const border = useMemo(() => {
    const hw = width / 2
    const hh = height / 2
    return new Float32Array([
      -hw, -hh, 0,
      hw, -hh, 0,
      hw, hh, 0,
      -hw, hh, 0,
    ])
  }, [width, height])

  return (
    <group>
      {/* White paper, well behind the strokes and field overlays. Skipped in MAP
          context so the Mapbox underlay shows in the artboard instead. */}
      {showPaper && (
        <mesh position={[0, 0, -2]} renderOrder={-10} raycast={() => null}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      )}

      {/* Crisp 1px page border (WebGL lines render at 1px regardless of zoom). */}
      <lineLoop position={[0, 0, -1.9]} renderOrder={-9} raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[border, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={borderColor} toneMapped={false} />
      </lineLoop>
    </group>
  )
}
