import { useCallback, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'
import { SNAP_THRESHOLD_PX, type SnapPoint } from '../geometry/spatialIndex'
import { snapOrtho } from '../geometry/snapMath'
import { getEditTargets } from '../geometry/editTargets'
import {
  buildRoomSnapTargets,
  snapRoomCorner,
  wouldStaySimple,
  wouldOverlap,
  clampToLot,
  projectOntoRings,
  nearAnyRingEdge,
  applyVertexUpdates,
  type DragRig,
  type VertexUpdate,
  type RoomSnapTargets,
  type Pt,
} from '../geometry/roomEdit'
import { centerlineToBandRing } from '../geometry/corridor'

/** Pick radius for grabbing an anchor point, in screen pixels (generous so any room corner is
 *  easy to catch — coincident corners then weld together via the drag rig). */
const PICK_RADIUS_PX = 16
/** Corners within this screen radius of the grabbed point weld together (move as one). */
const WELD_EPS_PX = 6
/** ...but the weld never exceeds this many WORLD units, so it only catches truly-coincident
 *  (shared) corners — never distinct neighbors (which would collapse rooms when zoomed out). */
const WELD_MAX_WORLD = 2
/** Overlap area (world units²) above which a room-corner move is rejected (shared edges ≈ 0). */
const OVERLAP_AREA_EPS = 1

/**
 * Edit tool (Illustrator "direct selection" style). Press near an anchor point to
 * grab and drag it, OR press on a text label to reposition it. One undo step per
 * drag (snapshot on grab).
 *
 * WHAT is editable depends on the active pipeline layer (getEditTargets), so the
 * tool transforms the geometry that layer is about — and only on the active board
 * (it reads the live store; neighbor boards are read-only ghosts):
 *   • Lot Boundary layer → the boundary ring vertices.
 *   • Circulation layer  → the circulation centerline vertices.
 *   • other layers       → the planar-graph vertices.
 *
 * ALL anchors snap onto nearby geometry while dragging — a boundary or circulation
 * vertex can land exactly on the lot boundary, another centerline, or a graph vertex
 * so the pieces actually touch. The spatial index keys the boundary/circulation
 * vertices ('bnd:v<i>', 'circ:<pathId>:v<i>'), so the dragged anchor (and its own
 * incident edge midpoints) is excluded by id and never snaps to itself. Holding
 * Shift constrains the drag to a H/V axis from the grab origin (snap still wins).
 */

/** The spatial-index vertex id for a drag key (so nearest() can exclude self). */
function indexIdForKey(key: string): string {
  if (key.startsWith('bnd:')) return `bnd:v${key.slice(4)}`
  if (key.startsWith('circ:')) {
    const parts = key.split(':')
    return `circ:${parts[1]}:v${parts[2]}`
  }
  return key // graph vertex id
}
export function useVectorEdit() {
  const { camera } = useThree()
  const beginHistory = useDrawingStore((s) => s.beginHistory)
  const setVertexPositions = useDrawingStore((s) => s.setVertexPositions)
  const setBoundaryPoint = useDrawingStore((s) => s.setBoundaryPoint)
  const setCirculationPoint = useDrawingStore((s) => s.setCirculationPoint)
  const setIntentPinPoint = useDrawingStore((s) => s.setIntentPinPoint)
  const setDepartmentPoint = useDrawingStore((s) => s.setDepartmentPoint)
  const setRoomVertices = useDrawingStore((s) => s.setRoomVertices)
  const beginRoomCornerDrag = useDrawingStore((s) => s.beginRoomCornerDrag)
  const moveText = useDrawingStore((s) => s.moveText)

  // Key of the anchor being dragged (see getEditTargets for the key grammar). Room corners
  // use the sentinel 'room' here and carry their welded cluster + snap targets in refs.
  const draggingKeyRef = useRef<string | null>(null)
  // Anchor position at grab time — the origin for the Shift-ortho constraint.
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null)
  const draggingTextRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  // Active room-corner drag: the rig (welded anchors + sliding T-junction vertices), the
  // snap candidates, the main-circulation bands (overlap obstacles), and — when the grabbed
  // corner sits on a hallway border — the rings to keep it glued to (so no corridor gap).
  const roomRigRef = useRef<DragRig | null>(null)
  const roomSnapRef = useRef<RoomSnapTargets | null>(null)
  const roomBandsRef = useRef<Pt[][] | null>(null)
  const roomCorridorRef = useRef<Pt[][] | null>(null)
  const [snap, setSnap] = useState<SnapPoint | null>(null)

  /** Apply a dragged anchor's new position to the right store slice by key. */
  const applyDrag = useCallback(
    (key: string, x: number, y: number) => {
      if (key.startsWith('pin:')) {
        setIntentPinPoint(key.slice(4), x, y)
      } else if (key.startsWith('dept:')) {
        setDepartmentPoint(key.slice(5), x, y)
      } else if (key.startsWith('bnd:')) {
        setBoundaryPoint(Number(key.slice(4)), x, y)
      } else if (key.startsWith('circ:')) {
        const parts = key.split(':')
        setCirculationPoint(parts[1], Number(parts[2]), x, y)
      } else {
        setVertexPositions({ [key]: { x, y } })
      }
    },
    [setBoundaryPoint, setCirculationPoint, setIntentPinPoint, setDepartmentPoint, setVertexPositions],
  )

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      const zoom = (camera as OrthographicCamera).zoom || 1
      const store = useDrawingStore.getState()
      const px = e.point.x
      const py = e.point.y

      // 1) Text labels (hit-test the rendered box; anchor is top-left, text goes
      //    right and downward on screen = -y in world).
      for (let i = store.textLabels.length - 1; i >= 0; i--) {
        const l = store.textLabels[i]
        const w = Math.max(8, l.text.length * l.size * 0.6) / zoom
        const h = (l.size * 1.3) / zoom
        if (px >= l.x && px <= l.x + w && py <= l.y && py >= l.y - h) {
          ;(e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.nativeEvent.pointerId)
          draggingTextRef.current = { id: l.id, dx: px - l.x, dy: py - l.y }
          beginHistory()
          return
        }
      }

      // 2) Layer-appropriate anchors (nearest within a screen radius).
      const radius = PICK_RADIUS_PX / zoom
      let bestDist = radius * radius
      let best: { key: string; x: number; y: number } | null = null
      const { points } = getEditTargets(store.activeLayer, store.graph, store.boundary, store.circulationPaths, store.intentPins, store.departments, store.rooms)
      for (const t of points) {
        const dx = t.x - px
        const dy = t.y - py
        const d = dx * dx + dy * dy
        if (d <= bestDist) {
          bestDist = d
          best = t
        }
      }
      if (!best) return

      ;(e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.nativeEvent.pointerId)
      // Room corner: snapshot, split T-junction neighbor edges + build the drag rig (welded
      // anchors + sliding T-junction vertices, so neighbors stay glued — no gaps). Capture
      // main-circulation bands as overlap obstacles, and if the grabbed corner sits on a
      // hallway border, keep it glued there for the drag (corridor stays bordered by rooms).
      if (best.key.startsWith('room:')) {
        beginHistory()
        const weld = Math.min(WELD_EPS_PX / zoom, WELD_MAX_WORLD)
        const rig = beginRoomCornerDrag(best.x, best.y, weld)
        const fresh = useDrawingStore.getState()
        const bands = fresh.circulationPaths
          .filter((p) => p.tier !== 'MINOR')
          .map((p) => centerlineToBandRing(p.centerline, p.width))
          .filter((r) => r.length >= 3)
        roomRigRef.current = rig
        roomBandsRef.current = bands
        roomCorridorRef.current = nearAnyRingEdge(bands, best.x, best.y, weld) ? bands : null
        roomSnapRef.current = buildRoomSnapTargets(fresh.rooms, fresh.boundary, fresh.circulationPaths, rig.anchors)
        draggingKeyRef.current = 'room'
        dragOriginRef.current = { x: best.x, y: best.y }
        return
      }
      draggingKeyRef.current = best.key
      dragOriginRef.current = { x: best.x, y: best.y }
      beginHistory()
    },
    [camera, beginHistory, beginRoomCornerDrag],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const text = draggingTextRef.current
      if (text) {
        moveText(text.id, e.point.x - text.dx, e.point.y - text.dy)
        return
      }
      const key = draggingKeyRef.current
      if (!key) return
      const zoom = (camera as OrthographicCamera).zoom || 1

      // Room-corner drag: snap onto a neighbor wall / corridor border / lot boundary, then
      // move the rig (welded anchors + sliding T-junction vertices) so adjacent rooms reflow
      // with no gaps. Reject moves that self-intersect or overlap a room / circulation band.
      if (key === 'room') {
        const rig = roomRigRef.current
        const cands = roomSnapRef.current
        if (!rig || !cands) return
        const store = useDrawingStore.getState()
        let rx = e.point.x
        let ry = e.point.y
        let snapped: SnapPoint | null = null
        if (store.snappingEnabled) {
          const s = snapRoomCorner(cands, rx, ry, SNAP_THRESHOLD_PX / zoom)
          if (s) {
            rx = s.x
            ry = s.y
            snapped = { x: rx, y: ry, kind: 'VERTEX', vid: null, edge: null }
          }
        }
        if (!snapped && e.nativeEvent.shiftKey && dragOriginRef.current) {
          const o = snapOrtho(dragOriginRef.current, { x: rx, y: ry })
          rx = o.x
          ry = o.y
        }
        // Keep a corridor-border corner glued to the hallway border (no gap, no intrusion).
        if (roomCorridorRef.current) {
          const c = projectOntoRings(roomCorridorRef.current, rx, ry)
          rx = c.x
          ry = c.y
          snapped = { x: rx, y: ry, kind: 'VERTEX', vid: null, edge: null }
        }
        // Hard constraint: a room corner can never leave the lot — clamp to the boundary.
        if (store.boundary && store.boundary.ring.length >= 3) {
          const c = clampToLot(store.boundary.ring, rx, ry)
          if (c.x !== rx || c.y !== ry) {
            rx = c.x
            ry = c.y
            snapped = { x: rx, y: ry, kind: 'VERTEX', vid: null, edge: null }
          }
        }
        // Anchors snap to the cursor; sliders glide along their (moving) wall.
        const updates: VertexUpdate[] = rig.anchors.map((a) => ({ roomId: a.roomId, index: a.index, x: rx, y: ry }))
        for (const s of rig.sliders) {
          updates.push({
            roomId: s.roomId,
            index: s.index,
            x: rx + s.t * (s.far.x - rx),
            y: ry + s.t * (s.far.y - ry),
          })
        }
        // Validity: every affected room stays simple; no room/room or room/corridor overlap.
        const affected = new Set(updates.map((u) => u.roomId))
        const proposed = applyVertexUpdates(store.rooms, updates)
        let valid = true
        for (let i = 0; i < store.rooms.length; i++) {
          if (affected.has(store.rooms[i].roomId) && !wouldStaySimple(proposed[i])) {
            valid = false
            break
          }
        }
        if (!valid) return
        if (wouldOverlap(store.rooms, updates, OVERLAP_AREA_EPS, roomBandsRef.current ?? [])) return
        setSnap(snapped)
        setRoomVertices(updates)
        return
      }

      let x = e.point.x
      let y = e.point.y
      // Snap onto nearby geometry (vertices/midpoints), excluding the dragged anchor
      // by its spatial-index id so it can't snap to itself — works for graph,
      // boundary, and circulation anchors alike. Intent pins and department centers are
      // free-floating field centers (not part of any geometry), so they move without snap.
      const store = useDrawingStore.getState()
      const isPin = key.startsWith('pin:') || key.startsWith('dept:')
      const sp = !isPin && store.snappingEnabled
        ? store.spatialIndex.nearest(x, y, SNAP_THRESHOLD_PX / zoom, new Set([indexIdForKey(key)]))
        : null
      if (sp) {
        x = sp.x
        y = sp.y
      } else if (e.nativeEvent.shiftKey && dragOriginRef.current) {
        const o = snapOrtho(dragOriginRef.current, { x, y })
        x = o.x
        y = o.y
      }
      setSnap(sp)
      applyDrag(key, x, y)
    },
    [applyDrag, moveText, camera, setRoomVertices],
  )

  const onPointerUp = useCallback(() => {
    draggingKeyRef.current = null
    dragOriginRef.current = null
    draggingTextRef.current = null
    roomRigRef.current = null
    roomSnapRef.current = null
    roomBandsRef.current = null
    roomCorridorRef.current = null
    setSnap(null)
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp, snap }
}
