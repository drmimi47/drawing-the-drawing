import { useMemo } from 'react'
import * as THREE from 'three'
import { useDrawingStore, type CanvasDoc, type CanvasEntry } from '../../store/drawingStore'
import type { Boundary } from '../../types/geometry'
import { StrokeView } from './StrokeView'
import { LockFieldView } from './LockFieldView'
import { MetaballOverlay } from './MetaballOverlay'
import { PinMarkers, PIN_REFERENCE_COLOR } from './IntentFieldView'
import { GridLattice } from './GridView'
import { UnderlayView } from './UnderlayView'
import { CorridorUnion } from './CirculationView'

/**
 * Read-only renderer for the NON-active design-option canvases (branches).
 *
 * Each inactive canvas's document is a snapshot in store.inactiveCanvasDocs; its
 * geometry is in absolute world coordinates, so it renders without any offset. Only
 * the page frame (white sheet + border) is positioned at the canvas's world origin.
 * Clicking the sheet activates that canvas (when no full-viewport interaction plane
 * is intercepting — DrawingLayer handles activation while a creation tool is live).
 */

const BORDER_COLOR = '#c0c6cf'
const BOUNDARY_COLOR = '#111111'
const BOUNDARY_OPEN_COLOR = '#dc2626'
const BOUNDARY_FILL_COLOR = '#ffffff'

/** Inactive boundary: white interior fill + outline (mirrors the active BoundaryView). */
function GhostBoundary({ boundary, infillOpacity }: { boundary: Boundary; infillOpacity: number }) {
  const isClosed = boundary.isClosed !== false
  const positions = useMemo(() => {
    const ring = boundary.ring
    if (ring.length < 2) return null
    if (isClosed) {
      const arr = new Float32Array(ring.length * 3)
      ring.forEach((p, i) => arr.set([p.x, p.y, 5], i * 3))
      return arr
    }
    const arr = new Float32Array((ring.length - 1) * 6)
    for (let i = 0; i < ring.length - 1; i++) {
      arr.set([ring[i].x, ring[i].y, 5, ring[i + 1].x, ring[i + 1].y, 5], i * 6)
    }
    return arr
  }, [boundary, isClosed])

  const shape = useMemo(() => {
    if (!isClosed || boundary.ring.length < 3) return null
    return new THREE.Shape(boundary.ring.map((p) => new THREE.Vector2(p.x, p.y)))
  }, [boundary, isClosed])

  if (!positions) return null
  const color = isClosed ? BOUNDARY_COLOR : BOUNDARY_OPEN_COLOR
  const geom = (
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[positions, 3]} />
    </bufferGeometry>
  )
  return (
    <group>
      {shape && infillOpacity > 0 && (
        <mesh position={[0, 0, 4.9]} renderOrder={19} frustumCulled={false} raycast={() => null}>
          <shapeGeometry args={[shape]} />
          <meshBasicMaterial
            color={BOUNDARY_FILL_COLOR}
            transparent
            opacity={infillOpacity}
            depthTest={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
      {isClosed ? (
        <lineLoop renderOrder={20} frustumCulled={false} raycast={() => null}>
          {geom}
          <lineBasicMaterial color={color} depthTest={false} transparent toneMapped={false} />
        </lineLoop>
      ) : (
        <lineSegments renderOrder={20} frustumCulled={false} raycast={() => null}>
          {geom}
          <lineBasicMaterial color={color} depthTest={false} transparent toneMapped={false} />
        </lineSegments>
      )}
    </group>
  )
}

/** Inactive circulation centerlines (slate), drawn in world space. */
function GhostCanvas({ entry, doc }: { entry: CanvasEntry; doc: CanvasDoc }) {
  const setActiveCanvas = useDrawingStore((s) => s.setActiveCanvas)
  const { origin } = entry
  const hw = doc.pageWidth / 2
  const hh = doc.pageHeight / 2

  const border = useMemo(
    () => new Float32Array([-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0]),
    [hw, hh],
  )

  return (
    <>
      {/* Page furniture (sheet, border, grid, underlay) is defined in local,
          origin-centered coords, so it's translated to the board's world origin —
          exactly like the active board's furniture. The white sheet is also the
          activation hit target (works when no interaction plane is intercepting). */}
      <group position={[origin.x, origin.y, 0]}>
        <mesh
          position={[0, 0, -2]}
          renderOrder={-10}
          onClick={(e) => {
            e.stopPropagation()
            setActiveCanvas(entry.id)
          }}
        >
          <planeGeometry args={[doc.pageWidth, doc.pageHeight]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <lineLoop position={[0, 0, -1.9]} renderOrder={-9} raycast={() => null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[border, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={BORDER_COLOR} toneMapped={false} />
        </lineLoop>
        <GridLattice
          context={doc.context}
          underlay={doc.underlay}
          gridType={doc.gridType}
          spacing={doc.gridSpacing}
          width={doc.pageWidth}
          height={doc.pageHeight}
        />
        <UnderlayView underlay={doc.underlay} />
      </group>

      {/* Content — absolute world coords, so no offset group. */}
      <LockFieldView locks={doc.lockPolygons} />
      {/* Matches the active board: the gradient (clipped to this board's page rect)
          shows only on the Intent layer; markers show on Intent (per-type) and Rooms
          (magenta), and are hidden on every other layer. */}
      {doc.intentPins.length > 0 && doc.activeLayer === 'INTENT' && (
        <MetaballOverlay
          pins={doc.intentPins}
          clip={{ minX: origin.x - hw, minY: origin.y - hh, maxX: origin.x + hw, maxY: origin.y + hh }}
        />
      )}
      {doc.intentPins.length > 0 && (doc.activeLayer === 'INTENT' || doc.activeLayer === 'ROOMS') && (
        <PinMarkers
          pins={doc.intentPins}
          pending={null}
          colorOverride={doc.activeLayer === 'INTENT' ? undefined : PIN_REFERENCE_COLOR}
        />
      )}
      {doc.boundary && <GhostBoundary boundary={doc.boundary} infillOpacity={doc.boundaryInfillOpacity} />}
      {doc.circulationPaths.length > 0 && <CorridorUnion paths={doc.circulationPaths} />}
      {doc.graph.strokes.map((stroke) => (
        <StrokeView key={stroke.id} graph={doc.graph} stroke={stroke} selected={false} />
      ))}
    </>
  )
}

export function InactiveCanvases() {
  const canvases = useDrawingStore((s) => s.canvases)
  const activeCanvasId = useDrawingStore((s) => s.activeCanvasId)
  const inactiveCanvasDocs = useDrawingStore((s) => s.inactiveCanvasDocs)

  return (
    <>
      {canvases.map((entry) => {
        if (entry.id === activeCanvasId) return null
        const doc = inactiveCanvasDocs[entry.id]
        if (!doc) return null
        return <GhostCanvas key={entry.id} entry={entry} doc={doc} />
      })}
    </>
  )
}
