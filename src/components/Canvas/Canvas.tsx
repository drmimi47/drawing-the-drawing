import { Canvas } from '@react-three/fiber'
import { useDrawingStore } from '../../store/drawingStore'
import { DotGrid } from './DotGrid'
import { DrawingLayer } from './DrawingLayer'

/**
 * Root R3F scene for Blindspot.
 *
 * Uses an orthographic camera for a flat, top-down 2D workspace. 1 world unit
 * maps to 1 screen pixel at zoom = 1, which keeps the geometry math intuitive
 * for the drawing + mutation systems added in later clusters.
 *
 * Cluster A scope: scene boots, clears to the light-gray workspace color, and
 * renders the infinite dot grid. Pan/zoom controls arrive in Cluster C.
 */
export function CanvasScene() {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const cursor = toolMode === 'DRAW' ? 'crosshair' : 'default'

  return (
    <div className="canvas-layer" style={{ cursor }}>
      <Canvas
        orthographic
        camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 1000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        dpr={[1, 2]}
      >
        {/* Workspace background (#F9F9F9). */}
        <color attach="background" args={['#f9f9f9']} />

        <DotGrid />
        <DrawingLayer />
      </Canvas>
    </div>
  )
}
