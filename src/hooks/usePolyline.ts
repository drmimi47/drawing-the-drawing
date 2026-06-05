import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore, activeOrigin } from '../store/drawingStore'
import type { SamplePoint } from '../types/geometry'
import type { SnapGuide } from '../types/geometry'
import { SNAP_THRESHOLD_PX, type SnapPoint } from '../geometry/spatialIndex'
import { buildGridSnapModel, snapToGrid, type GridSnapModel } from '../geometry/gridSnap'
import {
  checkParallelSnap,
  checkPerpendicularSnap,
  getLinesIntersection2D,
  getProjectedPointOnLine,
  nearestPointOnSegment,
  snapOrtho,
} from '../geometry/snapMath'
import { clampToPage } from '../geometry/page'

/**
 * Polyline tool (next to Draw). Click to drop straight-segment vertices; the
 * segment to the cursor previews live. Finish by double-clicking, pressing
 * Enter, or clicking near the first vertex (to close). Esc cancels. Committed as
 * a `straight` stroke so corners stay sharp (no Catmull-Rom smoothing).
 *
 * SNAPPING — priority matrix (highest wins, evaluated each pointer-move):
 *   P1  Endpoint   — cursor within SNAP_THRESHOLD_PX of a true vertex (committed
 *                    graph vertex OR an in-progress polyline vertex); locks to it
 *                    and emits an 'endpoint' guide (green □).
 *   P2  Midpoint   — cursor within SNAP_THRESHOLD_PX of an edge MIDPOINT (no
 *                    vertex was closer); locks to the exact centre and emits a
 *                    'midpoint' guide (green △). Its own tier so the centre of a
 *                    partition wall / easement is intuitively targetable.
 *   P3  Intersection — the APPARENT crossing of two nearby edges' infinite lines
 *                    (they need not actually meet); locks to it when the cursor is
 *                    within SNAP_THRESHOLD_PX of that virtual point. Emits an
 *                    'intersection' guide (green ✕).
 *   P4  Edge       — nearest point on a nearby committed edge span (lot boundary,
 *                    other circulation centerlines, graph walls): share the line
 *                    instead of near-missing it; emits an 'edge' guide (green ◇).
 *                    Promoted above the construction snaps below so that, mid-draw,
 *                    hovering directly over an existing line lands ON it rather than
 *                    being pulled onto a parallel/perpendicular ray as you approach.
 *   P5  Perpendicular — when a polyline session is active (≥1 vertex placed),
 *                    the segment P→cursor is perpendicular to a nearby edge;
 *                    cursor is locked to the foot of perpendicular on the line
 *                    through P that is ⊥ to that edge.
 *   P6  Parallel   — when a polyline session is active, the segment P→cursor
 *                    is parallel (within PARALLEL_THRESHOLD_RAD) to a nearby
 *                    edge; cursor is projected onto the parallel ray from P.
 *   P7  Extension  — when ≥2 vertices are placed, the cursor floats near the
 *                    infinite line continuing the last segment; locks onto that
 *                    line so the next segment stays collinear. Emits an
 *                    'extension' guide (dashed track along the trajectory).
 *   P8  Tracking   — object-snap tracking (O-TRACK). Anchors are acquired by
 *                    hovering a vertex/midpoint ~400ms (store.trackedPoints, ≤2);
 *                    moving away projects H/V alignment rays from them, locking the
 *                    cursor's x to an anchor's x and/or its y to an anchor's y
 *                    (two anchors ⇒ lock to their intersection). Emits a 'tracking'
 *                    guide; the TrackingOverlay draws the ✛ anchors + alignment rays.
 *
 * P5/P6/P7 only fire when `pointsRef.current.length > 0` (P7 needs ≥2) — the
 * freehand DRAW tool has a completely separate code path and is unaffected.
 *
 * Every snap sets isAdvanced=true so Shift-ortho is suppressed while a snap is
 * live — the geometric anchor is the stronger constraint and should win over a
 * H/V axis lock. Shift-ortho only applies on the open-space fallback.
 */

const CLOSE_DIST = 10
const PERP_THRESHOLD_MULT = 2.5   // perp snap radius = endpoint radius × this
const PARALLEL_THRESHOLD_RAD = 6 * (Math.PI / 180)  // 6° angular tolerance
const ACQUIRE_MS = 400            // stable hover before an O-TRACK anchor is acquired

// ---------------------------------------------------------------------------
// Snap priority matrix — module-level pure function (no hooks).
// Reads the Zustand spatial index via getState(), consistent with the existing
// onPointerDown pattern, so it's safe to call from event handlers and RAF
// callbacks (never during render).
// ---------------------------------------------------------------------------

interface SnapResult {
  /** Effective cursor position — already at the snapped coordinate. */
  pos: { x: number; y: number }
  /** Endpoint snap target (drives the existing blue SnapIndicator glyph). */
  snapTarget: SnapPoint | null
  /** Guide metadata for the overlay renderer. */
  guide: SnapGuide | null
  /** True when ANY snap is active — suppresses Shift-ortho so the snapped
   *  geometric anchor wins over a H/V axis lock. */
  isAdvanced: boolean
}

function resolveSnap(
  raw: { x: number; y: number },
  pts: { x: number; y: number }[],
  zoom: number,
): SnapResult {
  const { spatialIndex, snappingEnabled, snapGuidesEnabled: guides, trackedPoints } = useDrawingStore.getState()
  // Master snapping switch (Cluster 4): when off, every tier is bypassed and the
  // cursor rides raw pointer input (Shift-ortho, an explicit modifier, still works
  // via the no-snap fallback path in onPointerDown / the preview).
  if (!snappingEnabled) {
    return { pos: raw, snapTarget: null, guide: null, isAdvanced: false }
  }
  const snapRadiusW = SNAP_THRESHOLD_PX / zoom
  // Nearby COMMITTED edges (segment-cell 3×3 query — an edge is returned wherever
  // its span passes near the cursor, including the ends of long walls). Shared by
  // the perp / parallel construction snaps and the edge ("nearest on line") snap.
  const committed = spatialIndex.nearbyEdgeEndpoints(raw.x, raw.y)

  // The spatial index returns the single nearest snap target in range, with
  // VERTEX winning over MIDPOINT (endpoint intent is stronger). We split that one
  // result across the two top tiers below: a VERTEX hit feeds P1, a MIDPOINT hit
  // feeds P2. A vertex in range therefore always suppresses the midpoint, exactly
  // as CAD object-snap priority requires.
  const near = spatialIndex.nearest(raw.x, raw.y, snapRadiusW)

  // ── Priority 1: ENDPOINT snap (true vertices only) ──────────────────────
  // Candidates are committed graph vertices (when the index hit is a VERTEX) AND
  // the vertices of the in-progress polyline — so snapping engages mid-draw,
  // before anything has been committed. The last placed vertex (P) is excluded:
  // snapping the rubber band onto its own anchor would be a degenerate segment.
  let epPos: { x: number; y: number } | null = null
  let epVid: string | undefined
  let epDistSq = snapRadiusW * snapRadiusW

  if (near && near.kind === 'VERTEX') {
    epPos = { x: near.x, y: near.y }
    epVid = near.vid ?? undefined
    const dx = near.x - raw.x
    const dy = near.y - raw.y
    epDistSq = dx * dx + dy * dy
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i].x - raw.x
    const dy = pts[i].y - raw.y
    const d = dx * dx + dy * dy
    if (d < epDistSq) {
      epDistSq = d
      epPos = { x: pts[i].x, y: pts[i].y }
      epVid = undefined
    }
  }
  if (epPos) {
    // Emit the guide even on the very first point (pts.length === 0): the green
    // square should confirm an endpoint lock the moment the polyline starts. With
    // no prior vertex, from == to (the EndpointGlyph only reads toPoint anyway).
    const from: [number, number] =
      pts.length > 0 ? [pts[pts.length - 1].x, pts[pts.length - 1].y] : [epPos.x, epPos.y]
    // Vertex-to-vertex always snaps. With guides OFF it snaps silently (no indicator/guide).
    return {
      pos: epPos,
      snapTarget: guides ? { x: epPos.x, y: epPos.y, kind: 'VERTEX', vid: epVid ?? null, edge: null } : null,
      guide: guides
        ? { type: 'endpoint', fromPoint: from, toPoint: [epPos.x, epPos.y], sourceVertexId: epVid }
        : null,
      isAdvanced: true,
    }
  }

  // ── Priority 2: MIDPOINT snap ───────────────────────────────────────────
  // No vertex was in range (P1 didn't fire), so a MIDPOINT index hit owns the
  // cursor: lock exactly to the edge centre and emit a dedicated 'midpoint'
  // guide (green triangle). This makes the centre of a partition wall / easement
  // boundary a first-class, intuitively targetable anchor.
  if (guides && near && near.kind === 'MIDPOINT') {
    const from: [number, number] =
      pts.length > 0 ? [pts[pts.length - 1].x, pts[pts.length - 1].y] : [near.x, near.y]
    return {
      pos: { x: near.x, y: near.y },
      snapTarget: { x: near.x, y: near.y, kind: 'MIDPOINT', vid: null, edge: near.edge },
      guide: {
        type: 'midpoint',
        fromPoint: from,
        toPoint: [near.x, near.y],
      },
      isAdvanced: true,
    }
  }

  // ── Priority 3: INTERSECTION snap (apparent crossing of two nearby edges) ──
  // For each pair of nearby committed edges, compute where their INFINITE lines
  // cross. If that virtual point sits within snapRadiusW of the cursor, lock to
  // it — so you can anchor on where two walls *would* meet even before they touch.
  // Always active (no session required); only the cursor-proximity gate matters,
  // so far-flung crossings never hijack the cursor. O(n²) over a tiny local set.
  if (guides) {
    let bestIxnDist = snapRadiusW
    let bestIxnPos: { x: number; y: number } | null = null
    for (let i = 0; i < committed.length; i++) {
      for (let j = i + 1; j < committed.length; j++) {
        const I = getLinesIntersection2D(committed[i].a, committed[i].b, committed[j].a, committed[j].b)
        if (!I) continue
        const d = Math.hypot(I.x - raw.x, I.y - raw.y)
        if (d < bestIxnDist) {
          bestIxnDist = d
          bestIxnPos = { x: I.x, y: I.y }
        }
      }
    }
    if (bestIxnPos) {
      const from: [number, number] =
        pts.length > 0 ? [pts[pts.length - 1].x, pts[pts.length - 1].y] : [bestIxnPos.x, bestIxnPos.y]
      return {
        pos: bestIxnPos,
        snapTarget: null,
        guide: { type: 'intersection', fromPoint: from, toPoint: [bestIxnPos.x, bestIxnPos.y] },
        isAdvanced: true,
      }
    }
  }

  // ── Priority 4: ON-EDGE snap (cursor directly over a committed edge) ──────
  // Promoted ABOVE the perp/parallel/extension construction snaps so that, mid-
  // draw, the cursor reliably lands ON an existing line — the lot boundary or an
  // already-drawn circulation centerline — when hovering over it, instead of being
  // pulled onto a parallel/perpendicular ray as you approach it. A nearer vertex or
  // midpoint (P1/P2) still pre-empts this. Tight band (snapRadiusW) so you only
  // stick when genuinely on the line. Only COMMITTED edges are candidates (snapping
  // onto the in-progress rubber band would fold the line back on itself), so this
  // never fires for the very geometry you're drawing — only for sharing existing
  // edges, which is exactly the context-aware behaviour wanted for circulation.
  {
    let bestEdgeDist = snapRadiusW
    let bestEdgePos: { x: number; y: number } | null = null
    let bestEdgeKey: string | null = null
    for (const { key, a, b } of committed) {
      const np = nearestPointOnSegment(raw, a, b)
      if (np.dist < bestEdgeDist) {
        bestEdgeDist = np.dist
        bestEdgePos = { x: np.x, y: np.y }
        bestEdgeKey = key
      }
    }
    if (bestEdgePos) {
      const from: [number, number] =
        pts.length > 0 ? [pts[pts.length - 1].x, pts[pts.length - 1].y] : [bestEdgePos.x, bestEdgePos.y]
      // Vertex-to-edge always snaps. With guides OFF it snaps silently (no guide visual).
      return {
        pos: bestEdgePos,
        snapTarget: null,
        guide: guides
          ? { type: 'edge', fromPoint: from, toPoint: [bestEdgePos.x, bestEdgePos.y], sourceEdgeId: bestEdgeKey ?? undefined }
          : null,
        isAdvanced: true,
      }
    }
  }

  // ── Priorities 5–7: construction guides (require an active polyline session) ──
  if (guides && pts.length > 0) {
    const P = pts[pts.length - 1]
    const perpThresh = (SNAP_THRESHOLD_PX * PERP_THRESHOLD_MULT) / zoom
    // Candidate reference edges = nearby committed edges PLUS every segment of the
    // in-progress polyline. The active segments are always included (there are only
    // a handful per session) so you can snap perpendicular/parallel to a line you
    // just drew — the key behaviour that was missing before any stroke was committed.
    const activeSegs: Array<{ key: string; a: { x: number; y: number }; b: { x: number; y: number } }> = []
    for (let i = 0; i < pts.length - 1; i++) {
      activeSegs.push({ key: `active:${i}`, a: pts[i], b: pts[i + 1] })
    }
    const candidates = [...committed, ...activeSegs]

    // ── Priority 5: perpendicular snap ──────────────────────────────────
    // Pick the candidate edge whose perp-line foot is closest to M.
    let bestPerpDist = perpThresh
    let bestPerpPos: { x: number; y: number } | null = null
    let bestPerpEdgeKey: string | null = null
    for (const { key, a, b } of candidates) {
      const foot = checkPerpendicularSnap(P, raw, a, b, perpThresh)
      if (foot) {
        const d = Math.hypot(raw.x - foot.x, raw.y - foot.y)
        if (d < bestPerpDist) {
          bestPerpDist = d
          bestPerpPos = foot
          bestPerpEdgeKey = key
        }
      }
    }
    if (bestPerpPos) {
      return {
        pos: bestPerpPos,
        snapTarget: null,
        guide: {
          type: 'perpendicular',
          fromPoint: [P.x, P.y],
          toPoint: [bestPerpPos.x, bestPerpPos.y],
          sourceEdgeId: bestPerpEdgeKey ?? undefined,
        },
        isAdvanced: true,
      }
    }

    // ── Priority 6: parallel snap ────────────────────────────────────────
    // Pre-compute normalized P→M direction once; skip if cursor == P.
    const vx = raw.x - P.x
    const vy = raw.y - P.y
    const vLen = Math.sqrt(vx * vx + vy * vy)
    if (vLen > 1e-10) {
      const vnx = vx / vLen
      const vny = vy / vLen
      let bestCross = Math.sin(PARALLEL_THRESHOLD_RAD)
      let bestParallelPos: { x: number; y: number } | null = null
      let bestParallelEdgeKey: string | null = null
      for (const { key, a, b } of candidates) {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dLen = Math.sqrt(dx * dx + dy * dy)
        if (dLen < 1e-10) continue
        // |sin θ| between P→M and edge direction — ranks angular deviation
        const cross = Math.abs((dx / dLen) * vny - (dy / dLen) * vnx)
        if (cross < bestCross) {
          const pt = checkParallelSnap(P, raw, a, b, PARALLEL_THRESHOLD_RAD)
          if (pt) {
            bestCross = cross
            bestParallelPos = pt
            bestParallelEdgeKey = key
          }
        }
      }
      if (bestParallelPos) {
        return {
          pos: bestParallelPos,
          snapTarget: null,
          guide: {
            type: 'parallel',
            fromPoint: [P.x, P.y],
            toPoint: [bestParallelPos.x, bestParallelPos.y],
            sourceEdgeId: bestParallelEdgeKey ?? undefined,
          },
          isAdvanced: true,
        }
      }
    }

    // ── Priority 7: extension snap (collinear continuation of last segment) ──
    // With ≥2 points placed, project the cursor onto the INFINITE line through
    // the last segment (P_prev → P). If it floats within the tight snapRadiusW of
    // that line, lock it on — so the next segment can continue exactly collinear
    // with the one just drawn. Lower than perp/parallel (those express intent
    // against OTHER edges); this only governs the cursor's own trajectory.
    if (pts.length >= 2) {
      const Pprev = pts[pts.length - 2]
      const foot = getProjectedPointOnLine(raw, Pprev, P)
      const d = Math.hypot(raw.x - foot.x, raw.y - foot.y)
      if (d <= snapRadiusW) {
        return {
          pos: foot,
          snapTarget: null,
          // from = P_prev so the dashed track always has a stable direction and
          // visually passes through the existing segment and beyond.
          guide: { type: 'extension', fromPoint: [Pprev.x, Pprev.y], toPoint: [foot.x, foot.y] },
          isAdvanced: true,
        }
      }
    }
  }

  // ── Priority 8: object-snap tracking (O-TRACK) ──────────────────────────
  // Acquired anchors (store.trackedPoints, ≤2) project axis-alignment rays. Lock
  // the cursor's x to the nearest anchor x within snapRadiusW and/or its y to the
  // nearest anchor y — so two anchors snap the cursor to their (T1.x, T2.y)
  // intersection. Lower than the object snaps above (it aligns to remembered
  // points, not to geometry directly under the cursor); the last tier before raw.
  if (guides && trackedPoints.length > 0) {
    let bestVx: number | null = null
    let bestVxDist = snapRadiusW
    let bestHy: number | null = null
    let bestHyDist = snapRadiusW
    for (const { coords } of trackedPoints) {
      const dvx = Math.abs(raw.x - coords[0])
      if (dvx < bestVxDist) {
        bestVxDist = dvx
        bestVx = coords[0]
      }
      const dhy = Math.abs(raw.y - coords[1])
      if (dhy < bestHyDist) {
        bestHyDist = dhy
        bestHy = coords[1]
      }
    }
    if (bestVx !== null || bestHy !== null) {
      const snapped = { x: bestVx ?? raw.x, y: bestHy ?? raw.y }
      return {
        pos: snapped,
        snapTarget: null,
        // toPoint = locked cursor; TrackingOverlay derives the alignment rays by
        // matching each anchor's x/y against it, so a single guide covers both lines.
        guide: { type: 'tracking', fromPoint: [snapped.x, snapped.y], toPoint: [snapped.x, snapped.y] },
        isAdvanced: true,
      }
    }
  }

  return { pos: raw, snapTarget: null, guide: null, isAdvanced: false }
}

// ---------------------------------------------------------------------------

export function usePolyline() {
  const { camera } = useThree()
  const baseWidth = useDrawingStore((s) => s.baseWidth)
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const commitStroke = useDrawingStore((s) => s.commitStroke)

  // Lot structural-grid snap model — circulation paths ride the grid (parallel/perp to
  // the walls). Rebuilt only when the boundary / seams / spacing change; read from a ref
  // inside the (memoized) pointer handlers.
  const gridBoundary = useDrawingStore((s) => s.boundary)
  const lotGridSpacing = useDrawingStore((s) => s.lotGridSpacing)
  const lotGridSeams = useDrawingStore((s) => s.lotGridSeams)
  const gridModel = useMemo<GridSnapModel | null>(() => {
    if (!gridBoundary || gridBoundary.isClosed === false || gridBoundary.ring.length < 3) return null
    return buildGridSnapModel(gridBoundary.ring, lotGridSpacing, lotGridSeams)
  }, [gridBoundary, lotGridSpacing, lotGridSeams])
  const gridModelRef = useRef<GridSnapModel | null>(gridModel)
  gridModelRef.current = gridModel

  const [points, setPoints] = useState<{ x: number; y: number }[]>([])
  // Raw (un-snapped) cursor position from the last pointer-move event.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  // Active endpoint snap target (drives the blue SnapIndicator glyph).
  const [snap, setSnap] = useState<SnapPoint | null>(null)
  // True when P2/P3 snap is active — suppresses Shift-ortho in the preview.
  const [isAdvancedSnap, setIsAdvancedSnap] = useState(false)
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const pointsRef = useRef<{ x: number; y: number }[]>([])

  // Coalesce pointer moves into one update per animation frame.
  const cursorRef = useRef<{ x: number; y: number } | null>(null)
  const snapRef = useRef<SnapPoint | null>(null)
  const snapGuideRef = useRef<SnapGuide | null>(null)
  const isAdvancedSnapRef = useRef(false)
  const rafRef = useRef(0)
  // True once the active path's loop has been closed (last vertex placed back on
  // the first). Only a closed loop commits a lot boundary — an open path doesn't.
  const closedRef = useRef(false)
  // Vertices popped by mid-draw Ctrl+Z, so Ctrl+Shift+Z / Ctrl+Y can re-add them.
  // Cleared when a fresh vertex is placed (the redo chain is then broken).
  const redoStackRef = useRef<{ x: number; y: number }[]>([])

  // O-TRACK acquisition: id of the committed anchor currently under the cursor,
  // and the pending acquire timer (fires after ACQUIRE_MS of stable hover).
  const hoverAnchorRef = useRef<string | null>(null)
  const acquireTimerRef = useRef(0)

  const clearAcquireTimer = useCallback(() => {
    if (acquireTimerRef.current) {
      clearTimeout(acquireTimerRef.current)
      acquireTimerRef.current = 0
    }
    hoverAnchorRef.current = null
  }, [])

  const flushCursor = useCallback(() => {
    rafRef.current = 0
    setCursor(cursorRef.current)
    setSnap(snapRef.current)
    setIsAdvancedSnap(isAdvancedSnapRef.current)
    useDrawingStore.getState().setSnapGuide(snapGuideRef.current)
  }, [])

  const scheduleCursor = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flushCursor)
  }, [flushCursor])

  const reset = useCallback(() => {
    pointsRef.current = []
    setPoints([])
    setCursor(null)
    setSnap(null)
    setIsAdvancedSnap(false)
    cursorRef.current = null
    snapRef.current = null
    snapGuideRef.current = null
    isAdvancedSnapRef.current = false
    closedRef.current = false
    redoStackRef.current = []
    useDrawingStore.getState().setSnapGuide(null)
    // O-TRACK anchors are per-path — drop them on completion / cancellation.
    clearAcquireTimer()
    useDrawingStore.getState().clearTrackedPoints()
  }, [clearAcquireTimer])

  const finish = useCallback(() => {
    const pts = pointsRef.current
    const layer = useDrawingStore.getState().activeLayer
    // Stage 1: only a *closed* polyline drawn in the BOUNDARY layer commits the
    // lot boundary (a first-class entity that gates the Circulation layer). An
    // open path is left in progress so the user can close it — Enter/double-click
    // on a path whose endpoints already coincide counts as closing it.
    if (layer === 'BOUNDARY') {
      const first = pts[0]
      const last = pts[pts.length - 1]

      // REPAIR: if the boundary is currently OPEN (a segment was erased) and this
      // path bridges its two free ends, splice the path in to re-close the lot —
      // no need to redraw the whole boundary. The ends are snap-able, so the user
      // just snaps the path's start to one free end and its end to the other.
      const b = useDrawingStore.getState().boundary
      if (b && b.isClosed === false && b.ring.length >= 2 && pts.length >= 2) {
        const ringPts = b.ring
        const A = ringPts[0]
        const B = ringPts[ringPts.length - 1]
        const near = (p: { x: number; y: number }, q: { x: number; y: number }) =>
          Math.hypot(p.x - q.x, p.y - q.y) <= CLOSE_DIST
        // Interior points of the drawn path (excluding its two endpoints, which
        // coincide with the free ends), ordered so the closed ring reads A…B…→A.
        const interior = pts.slice(1, -1).map((p) => ({ x: p.x, y: p.y }))
        let merged: { x: number; y: number }[] | null = null
        if (near(first, A) && near(last, B)) merged = [...ringPts, ...interior.reverse()]
        else if (near(first, B) && near(last, A)) merged = [...ringPts, ...interior]
        if (merged) {
          useDrawingStore.getState().setBoundary(merged) // commits closed (isClosed: true)
          reset()
          return
        }
      }

      // Otherwise: only a *closed* loop commits a fresh boundary (replacing any
      // existing one). An open path is left in progress so the user can close it —
      // Enter/Space on a path whose endpoints already coincide counts as closing.
      const endpointsMeet =
        pts.length >= 3 && Math.hypot(last.x - first.x, last.y - first.y) <= CLOSE_DIST
      if (closedRef.current || endpointsMeet) {
        if (pts.length >= 3) {
          useDrawingStore.getState().setBoundary(pts.map((p) => ({ x: p.x, y: p.y })))
        }
        reset()
        return
      }
      // OPEN path while a CLOSED lot exists → a GRID SEAM (splits the internal grid).
      // Endpoints snap to boundary vertices via the normal polyline snapping.
      if (b && b.isClosed !== false && pts.length >= 2) {
        useDrawingStore.getState().addLotGridSeam(pts.map((p) => ({ x: p.x, y: p.y })))
        reset()
        return
      }
      // Otherwise (no closed lot yet) → keep the path active; the user must close the loop.
      return
    }
    // Stage 2: an (open) polyline in the CIRCULATION layer commits a hallway
    // centerline, auto-offset to the corridor band.
    if (layer === 'CIRCULATION') {
      if (pts.length >= 2) {
        useDrawingStore.getState().addCirculationPath(pts.map((p) => ({ x: p.x, y: p.y })))
      }
      reset()
      return
    }
    if (pts.length >= 2) {
      const half = baseWidth / 2
      const sample: SamplePoint[] = pts.map((p) => ({ x: p.x, y: p.y, w: half }))
      commitStroke(sample, strokeColor, undefined, true)
    }
    reset()
  }, [baseWidth, strokeColor, commitStroke, reset])

  const cancel = useCallback(() => reset(), [reset])

  // Key handling: Shift state (preview reacts immediately on hold/release without
  // needing a pointer move) and Space/Enter/Esc/Ctrl+Z control flow. Space ends the
  // line (replacing double-click); it only does so while a path is in progress, so
  // it still works as the hold-to-pan modifier when no polyline is being drawn.
  //
  // Registered on the CAPTURE phase so that, mid-draw, Ctrl+Z pops the last vertex
  // (and Ctrl+Shift+Z / Ctrl+Y re-adds it) and stops the event before the app-level
  // document undo/redo (bubble phase) can fire.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(true)
        return
      }

      // Mid-draw vertex undo/redo. Handled above the "no active path" guard so the
      // redo still works after popping every vertex. Only consumed (stopping the
      // global undo/redo) when there's actually a vertex to pop or re-add — so when
      // no polyline is in progress these fall through to the document history.
      const mod = e.ctrlKey || e.metaKey
      const lkey = e.key.toLowerCase()
      const isUndo = mod && lkey === 'z' && !e.shiftKey
      const isRedo = mod && ((lkey === 'z' && e.shiftKey) || lkey === 'y')
      if (isUndo && pointsRef.current.length > 0) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const popped = pointsRef.current[pointsRef.current.length - 1]
        redoStackRef.current.push({ x: popped.x, y: popped.y })
        pointsRef.current = pointsRef.current.slice(0, -1)
        setPoints(pointsRef.current)
        closedRef.current = false
        return
      }
      if (isRedo && redoStackRef.current.length > 0) {
        e.preventDefault()
        e.stopImmediatePropagation()
        pointsRef.current = [...pointsRef.current, redoStackRef.current.pop()!]
        setPoints(pointsRef.current)
        return
      }

      if (pointsRef.current.length === 0) return
      if (e.code === 'Space' || e.key === 'Enter') {
        if (e.repeat) return // ignore auto-repeat while the key is held
        e.preventDefault()
        finish()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [finish, cancel])

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    clearAcquireTimer()
  }, [clearAcquireTimer])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      const pts = pointsRef.current
      const zoom = (camera as OrthographicCamera).zoom || 1
      const state = useDrawingStore.getState()
      const raw = clampToPage({ x: e.point.x, y: e.point.y }, state.pageWidth, state.pageHeight, activeOrigin(state))

      // Run the full priority matrix at click time (not just the last move result)
      // so the committed vertex is at the precise snapped coordinate.
      const { pos, snapTarget, isAdvanced } = resolveSnap(raw, pts, zoom)

      let p = pos
      // Circulation rides the lot grid: snap to a grid node / line (first point prefers a
      // grid∩boundary point) so paths stay parallel/perpendicular to the established grid.
      const gridHit =
        state.activeLayer === 'CIRCULATION' && state.snapGuidesEnabled && gridModelRef.current
          ? snapToGrid(gridModelRef.current, pos.x, pos.y, SNAP_THRESHOLD_PX / zoom, pts.length === 0)
          : null
      if (gridHit) {
        p = gridHit
      } else if (!snapTarget && !isAdvanced && e.nativeEvent.shiftKey && pts.length > 0) {
        // Shift-ortho only when no geometric snap constrained the position.
        p = snapOrtho(pts[pts.length - 1], pos)
      }

      // Click near the first vertex closes the polyline into a loop.
      if (pts.length >= 2 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= CLOSE_DIST) {
        pointsRef.current = [...pts, { ...pts[0] }]
        closedRef.current = true
        finish()
        return
      }
      pointsRef.current = [...pts, p]
      redoStackRef.current = [] // a freshly placed vertex breaks the redo chain
      setPoints(pointsRef.current)
    },
    [finish, camera],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const zoom = (camera as OrthographicCamera).zoom || 1
      const state = useDrawingStore.getState()
      const raw = clampToPage({ x: e.point.x, y: e.point.y }, state.pageWidth, state.pageHeight, activeOrigin(state))
      // Run full snap pipeline; store results in refs to be flushed by RAF.
      // Note: for P2/P3 snaps, result.pos is the snapped position (not raw),
      // so the existing effCursor logic in the preview path works without
      // additional changes — it just reads `cursor` which becomes the snap pos.
      const result = resolveSnap(raw, pointsRef.current, zoom)
      // Circulation preview rides the lot grid (matches the commit in onPointerDown).
      const gridHit =
        state.activeLayer === 'CIRCULATION' && state.snapGuidesEnabled && gridModelRef.current
          ? snapToGrid(gridModelRef.current, result.pos.x, result.pos.y, SNAP_THRESHOLD_PX / zoom, pointsRef.current.length === 0)
          : null
      cursorRef.current = gridHit ?? result.pos
      snapRef.current = result.snapTarget
      snapGuideRef.current = result.guide
      isAdvancedSnapRef.current = result.isAdvanced
      scheduleCursor()

      // O-TRACK acquisition: when the active snap is on a COMMITTED vertex/midpoint
      // (snapTarget carries a real vid/edge), arm a stable-hover timer. Holding on
      // the same anchor for ACQUIRE_MS adds it to store.trackedPoints; moving to a
      // different anchor (or off geometry) re-arms / cancels it.
      const st = result.snapTarget
      let anchorId: string | null = null
      let anchorCoords: [number, number] | null = null
      if (st) {
        if (st.kind === 'VERTEX' && st.vid) {
          anchorId = `v:${st.vid}`
          anchorCoords = [st.x, st.y]
        } else if (st.kind === 'MIDPOINT' && st.edge) {
          anchorId = `m:${st.edge[0]}:${st.edge[1]}`
          anchorCoords = [st.x, st.y]
        }
      }
      if (anchorId !== hoverAnchorRef.current) {
        clearAcquireTimer()
        if (anchorId && anchorCoords) {
          hoverAnchorRef.current = anchorId
          const id = anchorId
          const coords = anchorCoords
          acquireTimerRef.current = window.setTimeout(() => {
            acquireTimerRef.current = 0
            // Guard against a late fire after the tool changed.
            if (useDrawingStore.getState().toolMode === 'POLYLINE') {
              useDrawingStore.getState().addTrackedPoint(id, coords)
            }
          }, ACQUIRE_MS)
        }
      }
    },
    [scheduleCursor, camera, clearAcquireTimer],
  )

  const onPointerUp = useCallback(() => {}, [])

  // Live preview = committed vertices + rubber-band to effective cursor.
  // effCursor priority: endpoint snap > advanced snap (already in cursor) > shift-ortho > raw.
  const half = baseWidth / 2
  const last = points[points.length - 1]
  let effCursor = cursor
  if (cursor) {
    if (snap) effCursor = { x: snap.x, y: snap.y }
    // When an advanced (perp/parallel) snap is active, cursor already holds
    // the snapped position — skip Shift-ortho so it doesn't fight the snap.
    else if (!isAdvancedSnap && isShiftPressed && last) effCursor = snapOrtho(last, cursor)
  }
  const rawPts = effCursor && points.length > 0 ? [...points, effCursor] : points
  const preview: SamplePoint[] = rawPts.map((p) => ({ x: p.x, y: p.y, w: half }))

  return { onPointerDown, onPointerMove, onPointerUp, preview, snap }
}
