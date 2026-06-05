import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useDrawingStore, canvasAt } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useScribble } from '../../hooks/useScribble'
import { useEraser } from '../../hooks/useEraser'
import { useSelection } from '../../hooks/useSelection'
import { useVectorEdit } from '../../hooks/useVectorEdit'
import { useLockTool } from '../../hooks/useLockTool'
import { useIntentPinTool } from '../../hooks/useIntentPinTool'
import { useDeptTool } from '../../hooks/useDeptTool'
import { usePolyline } from '../../hooks/usePolyline'
import { useTextTool } from '../../hooks/useTextTool'
import { getEditTargets } from '../../geometry/editTargets'
import { RibbonMesh, StrokeView, SELECTION_COLOR } from './StrokeView'
import { MarchingAntsLine } from './MarchingAntsLine'
import { LockFieldView } from './LockFieldView'
import { IntentFieldView } from './IntentFieldView'
import { DepartmentFieldOverlay } from './DepartmentFieldOverlay'
import { RoomsOverlay } from './RoomsOverlay'
import { SnapIndicator } from './SnapIndicator'
import { SnapGuideOverlay } from './SnapGuideOverlay'
import { TrackingOverlay } from './TrackingOverlay'
import { BoundaryView } from './BoundaryView'
import { LotGridView } from './LotGridView'
import { CirculationView } from './CirculationView'

type PointerHandler = (e: ThreeEvent<PointerEvent>) => void

/** Cosmetic anchor-point handles for the VECTOR edit tool (picking is on the plane). */
const EDIT_Z = 9.5 // above strokes, boundary, and circulation bands

/**
 * Editable-anchor handles for the Edit (VECTOR) tool. Shows the vertices AND a blue
 * wireframe of the edges for the geometry the active layer exposes (lot boundary
 * ring, circulation centerlines, or the planar graph) — see getEditTargets. Drawn
 * above everything (depthTest off) so the handles stay grabbable over corridor bands.
 */
function EditHandles() {
  const activeLayer = useDrawingStore((s) => s.activeLayer)
  const graph = useDrawingStore((s) => s.graph)
  const boundary = useDrawingStore((s) => s.boundary)
  const circulationPaths = useDrawingStore((s) => s.circulationPaths)
  const intentPins = useDrawingStore((s) => s.intentPins)
  const departments = useDrawingStore((s) => s.departments)
  const rooms = useDrawingStore((s) => s.rooms)

  const { positions, edgePositions } = useMemo(() => {
    const { points, edges } = getEditTargets(activeLayer, graph, boundary, circulationPaths, intentPins, departments, rooms)
    const positions = new Float32Array(points.length * 3)
    points.forEach((p, i) => {
      positions[i * 3] = p.x
      positions[i * 3 + 1] = p.y
      positions[i * 3 + 2] = EDIT_Z
    })
    const edgePositions = new Float32Array(edges.length * 6)
    edges.forEach((e, i) => edgePositions.set([e[0], e[1], EDIT_Z, e[2], e[3], EDIT_Z], i * 6))
    return { positions, edgePositions }
  }, [activeLayer, graph, boundary, circulationPaths, intentPins, departments, rooms])

  if (positions.length === 0) return null

  return (
    <>
      {edgePositions.length > 0 && (
        <lineSegments raycast={() => null} renderOrder={39} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[edgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={SELECTION_COLOR} depthTest={false} transparent toneMapped={false} />
        </lineSegments>
      )}
      <points raycast={() => null} renderOrder={40} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={8} sizeAttenuation={false} color={SELECTION_COLOR} depthTest={false} />
      </points>
    </>
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

  const scribble = useScribble()
  const eraser = useEraser()
  const selection = useSelection()
  const vectorEdit = useVectorEdit()
  const lockTool = useLockTool()
  const intentPinTool = useIntentPinTool()
  const deptTool = useDeptTool()
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
      toolMode === 'DEPT' ||
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
              : toolMode === 'DEPT'
                ? deptTool
                : toolMode === 'POLYLINE'
                  ? polyline
                  : toolMode === 'TEXT'
                    ? textTool
                    : scribble

  // Clicking inside a NEIGHBOR canvas activates it instead of editing the current
  // one (the interaction plane covers the whole viewport, so neighbor page meshes
  // can't receive the click directly while a creation tool is live). Empty gutter
  // space and the active canvas itself fall through to the tool as usual.
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    const state = useDrawingStore.getState()
    const hit = canvasAt(state, e.point.x, e.point.y)
    if (hit && hit !== state.activeCanvasId) {
      state.setActiveCanvas(hit)
      return
    }
    handlers.onPointerDown(e)
  }

  return (
    <>
      <InteractionPlane
        enabled={interactive}
        onPointerDown={handlePointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
      />
      <LockFieldView locks={lockPolygons} />
      <LotGridView />
      <IntentFieldView pins={intentPins} pending={pendingPin} />
      <DepartmentFieldOverlay />
      <RoomsOverlay />
      {/* Committed text renders as a DOM overlay above the map (see <TextOverlay/> in
          App), not inside the R3F scene, so it stays visible over the map substrate. */}
      {/* Circulation corridor bands (Stage 2) + lot boundary frame (Stage 1). */}
      <CirculationView />
      <BoundaryView />
      {graph.strokes.map((stroke) => (
        <StrokeView key={stroke.id} graph={graph} stroke={stroke} selected={selectedSet.has(stroke.id)} />
      ))}
      {/* Scribbles render as a raster <canvas> overlay above the map (see
          <ScribbleOverlay/> in App), not in the R3F scene. */}
      {toolMode === 'POLYLINE' && polyline.preview.length >= 2 && (
        <RibbonMesh points={polyline.preview} color={strokeColor} straight lineStyle={lineStyle} strokeWidth={baseWidth} onTop />
      )}
      {selection.outline && (
        <MarchingAntsLine points={selection.outline.points} closed={selection.outline.closed} />
      )}
      {lockTool.outline && lockTool.outline.points.length > 1 && (
        <MarchingAntsLine points={lockTool.outline.points} closed color="#e23b3b" />
      )}
      {toolMode === 'VECTOR' && <EditHandles />}
      {snapTarget && <SnapIndicator snap={snapTarget} />}
      {toolMode === 'POLYLINE' && <SnapGuideOverlay guide={activeSnapGuide} />}
      {toolMode === 'POLYLINE' && <TrackingOverlay />}
    </>
  )
}
