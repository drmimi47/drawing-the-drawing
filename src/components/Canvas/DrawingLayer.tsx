import { useLayoutEffect, useMemo, useRef } from 'react'
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
import { usePolyline } from '../../hooks/usePolyline'
import { useTextTool } from '../../hooks/useTextTool'
import { resolveStrokePoints } from '../../geometry/graph'
import type { Graph, LineStyle, SamplePoint, Stroke } from '../../types/geometry'
import { buildStrokeGeometry } from './strokeGeometry'
import { MarchingAntsLine } from './MarchingAntsLine'
import { LockFieldView } from './LockFieldView'
import { IntentFieldView } from './IntentFieldView'
import { TextLayer } from './TextLayer'
import { SnapIndicator } from './SnapIndicator'
import { SnapGuideOverlay } from './SnapGuideOverlay'
import { TrackingOverlay } from './TrackingOverlay'
import { BoundaryView } from './BoundaryView'
import { CirculationView } from './CirculationView'

type PointerHandler = (e: ThreeEvent<PointerEvent>) => void

const SELECTION_COLOR = '#2f6fed'

/**
 * A ribbon for a centerline polyline (smoothed unless `straight`), honoring the
 * stroke's drafting line style. Width falls back to 2× the first half-width when
 * `strokeWidth` is absent (older strokes / live previews).
 */
function RibbonMesh({
  points,
  color,
  straight,
  lineStyle,
  strokeWidth,
  onTop,
}: {
  points: SamplePoint[]
  color: string
  straight?: boolean
  lineStyle?: LineStyle
  strokeWidth?: number
  /** Draw above the lot-boundary fill/outline (used for the live polyline preview). */
  onTop?: boolean
}) {
  const width = strokeWidth ?? (points.length > 0 ? points[0].w * 2 : 2)
  const geometry = useMemo(
    () => buildStrokeGeometry(points, straight, lineStyle, width),
    [points, straight, lineStyle, width],
  )

  // The BufferGeometry instance is reused as `geometry` data updates (live draw /
  // polyline preview / vertex drag). Three.js caches the bounding sphere on first
  // cull and never refreshes it, so a moving preview keeps a stale sphere and gets
  // wrongly frustum-culled when zoomed in (small frustum). Recompute it on every
  // geometry change so culling stays correct without disabling it scene-wide.
  const geoRef = useRef<THREE.BufferGeometry>(null)
  useLayoutEffect(() => {
    const g = geoRef.current
    if (g && geometry.positions) g.computeBoundingSphere()
  }, [geometry])

  if (!geometry.positions || !geometry.indices) return null

  return (
    <mesh raycast={() => null} renderOrder={onTop ? 26 : 1} position={[0, 0, onTop ? 9 : 0]}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
        <bufferAttribute attach="index" args={[geometry.indices, 1]} />
      </bufferGeometry>
      <meshBasicMaterial color={color} side={THREE.DoubleSide} toneMapped={false} depthTest={!onTop} transparent={onTop} />
    </mesh>
  )
}

/** Resolve a graph stroke to centerline points and render it (tinted when selected). */
function StrokeView({ graph, stroke, selected }: { graph: Graph; stroke: Stroke; selected: boolean }) {
  const points = useMemo(() => resolveStrokePoints(graph, stroke), [graph, stroke])
  return (
    <RibbonMesh
      points={points}
      color={selected ? SELECTION_COLOR : stroke.color}
      straight={stroke.straight}
      lineStyle={stroke.lineStyle}
      strokeWidth={stroke.strokeWidth}
    />
  )
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
  onDoubleClick,
}: {
  enabled: boolean
  onPointerDown: PointerHandler
  onPointerMove: PointerHandler
  onPointerUp: () => void
  onDoubleClick?: () => void
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
      onDoubleClick={enabled ? onDoubleClick : undefined}
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
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const lineStyle = useDrawingStore((s) => s.lineStyle)
  const baseWidth = useDrawingStore((s) => s.baseWidth)
  const activeSnapGuide = useDrawingStore((s) => s.activeSnapGuide)
  const isSpaceDown = useCanvasStore((s) => s.isSpaceDown)

  const draw = useDrawing()
  const eraser = useEraser()
  const selection = useSelection()
  const vectorEdit = useVectorEdit()
  const lockTool = useLockTool()
  const intentPinTool = useIntentPinTool()
  const polyline = usePolyline()
  const textTool = useTextTool()

  const selectedSet = useMemo(() => new Set(selectedStrokeIds), [selectedStrokeIds])

  // Vector-edit drag uses the legacy blue square indicator. Polyline snap visuals
  // are owned entirely by SnapGuideOverlay (green/magenta CAD guides + glyphs), so
  // it doesn't double up with a blue square on endpoint snaps.
  const snapTarget = toolMode === 'VECTOR' ? vectorEdit.snap : null

  const isSelectionTool = toolMode === 'SELECT' || toolMode === 'LASSO'
  const interactive =
    (toolMode === 'DRAW' ||
      toolMode === 'POLYLINE' ||
      toolMode === 'ERASE' ||
      toolMode === 'VECTOR' ||
      toolMode === 'LASSO_LOCK' ||
      toolMode === 'INTENT_PIN' ||
      toolMode === 'TEXT' ||
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
              : toolMode === 'POLYLINE'
                ? polyline
                : toolMode === 'TEXT'
                  ? textTool
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
      <TextLayer />
      {/* Circulation corridor bands (Stage 2) + lot boundary frame (Stage 1). */}
      <CirculationView />
      <BoundaryView />
      {graph.strokes.map((stroke) => (
        <StrokeView key={stroke.id} graph={graph} stroke={stroke} selected={selectedSet.has(stroke.id)} />
      ))}
      {draw.live && (
        <RibbonMesh points={draw.live} color={draw.liveColor} lineStyle={lineStyle} strokeWidth={baseWidth} />
      )}
      {toolMode === 'POLYLINE' && polyline.preview.length >= 2 && (
        <RibbonMesh points={polyline.preview} color={strokeColor} straight lineStyle={lineStyle} strokeWidth={baseWidth} onTop />
      )}
      {selection.outline && (
        <MarchingAntsLine points={selection.outline.points} closed={selection.outline.closed} />
      )}
      {lockTool.outline && lockTool.outline.points.length > 1 && (
        <MarchingAntsLine points={lockTool.outline.points} closed color="#e23b3b" />
      )}
      {toolMode === 'VECTOR' && <VectorHandles graph={graph} />}
      {snapTarget && <SnapIndicator snap={snapTarget} />}
      {toolMode === 'POLYLINE' && <SnapGuideOverlay guide={activeSnapGuide} />}
      {toolMode === 'POLYLINE' && <TrackingOverlay />}
    </>
  )
}
