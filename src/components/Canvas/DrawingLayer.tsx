import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useDrawingStore } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useDrawing } from '../../hooks/useDrawing'
import { useEraser } from '../../hooks/useEraser'
import { useSelection } from '../../hooks/useSelection'
import { useVectorEdit } from '../../hooks/useVectorEdit'
import { useLockTool } from '../../hooks/useLockTool'
import { useIntentPinTool } from '../../hooks/useIntentPinTool'
import { resolveStrokePoints } from '../../geometry/graph'
import type { Graph, SamplePoint, Stroke } from '../../types/geometry'
import { buildRibbon, resampleCentripetalCatmullRom } from './strokeGeometry'
import { MarchingAntsLine } from './MarchingAntsLine'
import { LockFieldView } from './LockFieldView'
import { IntentFieldView } from './IntentFieldView'

type PointerHandler = (e: ThreeEvent<PointerEvent>) => void

const SELECTION_COLOR = '#2f6fed'

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

/** Resolve a graph stroke to centerline points and render it (tinted when selected). */
function StrokeView({ graph, stroke, selected }: { graph: Graph; stroke: Stroke; selected: boolean }) {
  const points = useMemo(() => resolveStrokePoints(graph, stroke), [graph, stroke])
  return <RibbonMesh points={points} color={selected ? SELECTION_COLOR : stroke.color} />
}

/** Cosmetic anchor-point handles for the VECTOR edit tool (picking is on the plane). */
function VectorHandles({ graph }: { graph: Graph }) {
  const positions = useMemo(() => {
    const ids = Object.keys(graph.vertices)
    const arr = new Float32Array(ids.length * 3)
    ids.forEach((id, i) => {
      const v = graph.vertices[id]
      arr[i * 3] = v.x
      arr[i * 3 + 1] = v.y
      arr[i * 3 + 2] = 4
    })
    return arr
  }, [graph])

  if (positions.length === 0) return null

  return (
    <points raycast={() => null} renderOrder={25}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={8} sizeAttenuation={false} color={SELECTION_COLOR} depthTest={false} />
    </points>
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
  const graph = useDrawingStore((s) => s.graph)
  const toolMode = useDrawingStore((s) => s.toolMode)
  const selectedStrokeIds = useDrawingStore((s) => s.selectedStrokeIds)
  const lockPolygons = useDrawingStore((s) => s.lockPolygons)
  const intentPins = useDrawingStore((s) => s.intentPins)
  const pendingPin = useDrawingStore((s) => s.pendingPin)
  const isSpaceDown = useCanvasStore((s) => s.isSpaceDown)

  const draw = useDrawing()
  const eraser = useEraser()
  const selection = useSelection()
  const vectorEdit = useVectorEdit()
  const lockTool = useLockTool()
  const intentPinTool = useIntentPinTool()

  const selectedSet = useMemo(() => new Set(selectedStrokeIds), [selectedStrokeIds])

  const isSelectionTool = toolMode === 'SELECT' || toolMode === 'LASSO'
  const interactive =
    (toolMode === 'DRAW' ||
      toolMode === 'ERASE' ||
      toolMode === 'VECTOR' ||
      toolMode === 'LASSO_LOCK' ||
      toolMode === 'INTENT_PIN' ||
      isSelectionTool) &&
    !isSpaceDown

  const handlers =
    toolMode === 'ERASE'
      ? eraser
      : isSelectionTool
        ? selection
        : toolMode === 'VECTOR'
          ? vectorEdit
          : toolMode === 'LASSO_LOCK'
            ? lockTool
            : toolMode === 'INTENT_PIN'
              ? intentPinTool
              : draw

  return (
    <>
      <InteractionPlane
        enabled={interactive}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
      />
      <LockFieldView locks={lockPolygons} />
      <IntentFieldView pins={intentPins} pending={pendingPin} />
      {graph.strokes.map((stroke) => (
        <StrokeView key={stroke.id} graph={graph} stroke={stroke} selected={selectedSet.has(stroke.id)} />
      ))}
      {draw.live && <RibbonMesh points={draw.live} color={draw.liveColor} />}
      {selection.outline && (
        <MarchingAntsLine points={selection.outline.points} closed={selection.outline.closed} />
      )}
      {lockTool.outline && lockTool.outline.points.length > 1 && (
        <MarchingAntsLine points={lockTool.outline.points} closed color="#e23b3b" />
      )}
      {toolMode === 'VECTOR' && <VectorHandles graph={graph} />}
    </>
  )
}
