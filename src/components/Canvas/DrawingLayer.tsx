import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useDrawingStore } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useDrawing } from '../../hooks/useDrawing'
import { useEraser } from '../../hooks/useEraser'
import { resolveStrokePoints } from '../../geometry/graph'
import type { Graph, SamplePoint, Stroke } from '../../types/geometry'
import { buildRibbon, resampleCentripetalCatmullRom } from './strokeGeometry'

type PointerHandler = (e: ThreeEvent<PointerEvent>) => void

/** A smooth variable-width ribbon for a centerline polyline. */
function RibbonMesh({ points, color }: { points: SamplePoint[]; color: string }) {
  const geometry = useMemo(() => {
    const smooth = resampleCentripetalCatmullRom(points)
    return buildRibbon(smooth)
  }, [points])

  if (!geometry.positions || !geometry.indices) return null

  return (
    <mesh raycast={() => null} renderOrder={1}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
        <bufferAttribute attach="index" args={[geometry.indices, 1]} />
      </bufferGeometry>
      <meshBasicMaterial color={color} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  )
}

/** Resolve a graph stroke to centerline points and render it. */
function StrokeView({ graph, stroke }: { graph: Graph; stroke: Stroke }) {
  const points = useMemo(() => resolveStrokePoints(graph, stroke), [graph, stroke])
  return <RibbonMesh points={points} color={stroke.color} />
}

/**
 * Invisible plane that covers the viewport and follows the camera, used purely
 * to receive pointer events. Its raycast hits give world-space coordinates.
 */
function InteractionPlane({
  enabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  enabled: boolean
  onPointerDown: PointerHandler
  onPointerMove: PointerHandler
  onPointerUp: () => void
}) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    const mesh = ref.current
    if (!mesh) return
    const cam = state.camera as THREE.OrthographicCamera
    const worldHeight = (cam.top - cam.bottom) / cam.zoom
    const worldWidth = (cam.right - cam.left) / cam.zoom
    if (!isFinite(worldHeight) || worldHeight <= 0) return
    mesh.position.set(cam.position.x, cam.position.y, 0)
    mesh.scale.set(worldWidth * 1.5, worldHeight * 1.5, 1)
  })

  return (
    <mesh
      ref={ref}
      onPointerDown={enabled ? onPointerDown : undefined}
      onPointerMove={enabled ? onPointerMove : undefined}
      onPointerUp={enabled ? onPointerUp : undefined}
    >
      <planeGeometry args={[1, 1]} />
      {/* Receives raycasts but draws nothing. */}
      <meshBasicMaterial colorWrite={false} depthWrite={false} />
    </mesh>
  )
}

export function DrawingLayer() {
  const graph = useDrawingStore((s) => s.graph)
  const toolMode = useDrawingStore((s) => s.toolMode)
  const isSpaceDown = useCanvasStore((s) => s.isSpaceDown)

  const draw = useDrawing()
  const eraser = useEraser()

  // Drawing/erasing is suspended while space is held (space = temporary pan).
  const interactive = (toolMode === 'DRAW' || toolMode === 'ERASE') && !isSpaceDown
  const handlers = toolMode === 'ERASE' ? eraser : draw

  return (
    <>
      <InteractionPlane
        enabled={interactive}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
      />
      {graph.strokes.map((stroke) => (
        <StrokeView key={stroke.id} graph={graph} stroke={stroke} />
      ))}
      {draw.live && <RibbonMesh points={draw.live} color={draw.liveColor} />}
    </>
  )
}
