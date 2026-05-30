import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useDrawingStore, type StrokePoint } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useDrawing } from '../../hooks/useDrawing'
import { useEraser } from '../../hooks/useEraser'
import { buildRibbon } from './strokeGeometry'

type PointerHandler = (e: ThreeEvent<PointerEvent>) => void

/** A single stroke rendered as a flat variable-width triangle ribbon. */
function StrokeMesh({ points, color }: { points: StrokePoint[]; color: string }) {
  const geometry = useMemo(() => buildRibbon(points), [points])
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
  const strokes = useDrawingStore((s) => s.strokes)
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
      {strokes.map((stroke) => (
        <StrokeMesh key={stroke.id} points={stroke.points} color={stroke.color} />
      ))}
      {draw.live && <StrokeMesh points={draw.live} color={draw.liveColor} />}
    </>
  )
}
