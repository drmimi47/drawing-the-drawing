import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { useDrawingStore } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'
import { ERASE_RADIUS_PX } from '../../hooks/useEraser'
import { CameraControls } from './CameraControls'
import { DrawingLayer } from './DrawingLayer'

/**
 * Root R3F scene for Blindspot.
 *
 * Orthographic camera for a flat 2D workspace (1 world unit = 1 px at zoom 1),
 * a plain white background, pan/zoom controls, and the drawing layer.
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

export function CanvasScene() {
  const cursor = useCanvasCursor()

  return (
    <div className="canvas-layer" style={{ cursor }}>
      <Canvas
        orthographic
        camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 1000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true, stencil: true }}
        dpr={[1, 2]}
      >
        {/* Plain white workspace. */}
        <color attach="background" args={['#ffffff']} />

        <CameraControls />
        <DrawingLayer />
      </Canvas>
    </div>
  )
}
