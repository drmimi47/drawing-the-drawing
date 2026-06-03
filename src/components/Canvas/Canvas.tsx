import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { useDrawingStore } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'
import { ERASE_RADIUS_PX } from '../../hooks/useEraser'
import { CameraControls } from './CameraControls'
import { DrawingLayer } from './DrawingLayer'
import { PageSheet } from './PageSheet'
import { GridView } from './GridView'
import { UnderlayView } from './UnderlayView'
import { InactiveCanvases } from './InactiveCanvases'

/**
 * Root R3F scene for Gradia Draw.
 *
 * Orthographic camera for a flat 2D workspace (1 world unit = 1 px at zoom 1),
 * a dark workspace backdrop with a centered white page sheet, pan/zoom
 * controls, and the drawing layer.
 */

/** Circular SVG cursor that matches the eraser radius on screen. */
const ERASER_CURSOR = (() => {
  const r = ERASE_RADIUS_PX
  const size = r * 2 + 4
  const c = size / 2
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<circle cx='${c}' cy='${c}' r='${r}' fill='rgba(0,0,0,0.04)' stroke='black' stroke-width='1.25'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, auto`
})()

function useCanvasCursor(): string {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const isSpaceDown = useCanvasStore((s) => s.isSpaceDown)
  const isPanning = useCanvasStore((s) => s.isPanning)

  return useMemo(() => {
    if (isPanning) return 'grabbing'
    if (isSpaceDown || toolMode === 'PAN') return 'grab'
    if (toolMode === 'DRAW' || toolMode === 'POLYLINE') return 'crosshair'
    if (toolMode === 'TEXT') return 'text'
    if (toolMode === 'ERASE') return ERASER_CURSOR
    if (toolMode === 'SELECT' || toolMode === 'LASSO') return 'crosshair'
    if (toolMode === 'LASSO_LOCK') return 'crosshair'
    if (toolMode === 'INTENT_PIN') return 'crosshair'
    if (toolMode === 'VECTOR') return 'default'
    return 'default'
  }, [toolMode, isSpaceDown, isPanning])
}

/** World-space origin of the currently active canvas (central canvas = 0,0). */
function useActiveOrigin(): [number, number] {
  const canvases = useDrawingStore((s) => s.canvases)
  const activeCanvasId = useDrawingStore((s) => s.activeCanvasId)
  const active = canvases.find((c) => c.id === activeCanvasId)
  return [active?.origin.x ?? 0, active?.origin.y ?? 0]
}

export function CanvasScene() {
  const cursor = useCanvasCursor()
  const [ox, oy] = useActiveOrigin()

  // Pointer routing is handled by the map overlay's z-index (set per layer in
  // MapView): in the Context layer the live map sits ABOVE this canvas, so it
  // captures events within the artboard while the workspace outside falls through
  // to the R3F camera here; in every other layer the frozen map sits BELOW, so the
  // canvas captures everything for drawing.
  return (
    <div className="canvas-layer" style={{ cursor }}>
      <Canvas
        orthographic
        camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 1000 }}
        // alpha: the canvas is transparent so the Mapbox underlay shows through
        // beneath the drawing layers (no opaque scene background).
        gl={{ antialias: true, preserveDrawingBuffer: true, stencil: true, alpha: true }}
        dpr={[1, 2]}
      >
        <CameraControls />
        {/* Read-only neighbor canvases (design-option branches) at their offsets. */}
        <InactiveCanvases />
        {/* The active canvas's page furniture is defined in local (origin-centered)
            coordinates, so it's translated to the active canvas's world origin. The
            DrawingLayer geometry is stored in absolute world coords and is NOT. */}
        <group position={[ox, oy, 0]}>
          <PageSheet />
          <GridView />
          <UnderlayView />
        </group>
        <DrawingLayer />
      </Canvas>
    </div>
  )
}
