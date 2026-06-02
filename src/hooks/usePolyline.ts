import { useCallback, useEffect, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { useDrawingStore } from '../store/drawingStore'
import type { SamplePoint } from '../types/geometry'
import type { SnapGuide } from '../types/geometry'
import { SNAP_THRESHOLD_PX, type SnapPoint } from '../geometry/spatialIndex'
import { checkParallelSnap, checkPerpendicularSnap } from '../geometry/snapMath'

/**
 * Polyline tool (next to Draw). Click to drop straight-segment vertices; the
 * segment to the cursor previews live. Finish by double-clicking, pressing
 * Enter, or clicking near the first vertex (to close). Esc cancels. Committed as
 * a `straight` stroke so corners stay sharp (no Catmull-Rom smoothing).
 *
 * SNAPPING — priority matrix (highest wins, evaluated each pointer-move):
 *   P1  Endpoint   — cursor within SNAP_THRESHOLD_PX of an existing vertex or
 *                    edge midpoint; locks exactly to it. (unchanged from before)
 *   P2  Perpendicular — when a polyline session is active (≥1 vertex placed),
 *                    the segment P→cursor is perpendicular to a nearby edge;
 *                    cursor is locked to the foot of perpendicular on the line
 *                    through P that is ⊥ to that edge.
 *   P3  Parallel   — when a polyline session is active, the segment P→cursor
 *                    is parallel (within PARALLEL_THRESHOLD_RAD) to a nearby
 *                    edge; cursor is projected onto the parallel ray from P.
 *
 * P2/P3 only fire when `pointsRef.current.length > 0` — the freehand DRAW tool
 * has a completely separate code path and is unaffected.
 *
 * Holding Shift (when nothing is snapped) constrains the segment to an
 * orthogonal (H/V) axis. Shift-ortho is skipped when an advanced snap (P2/P3)
 * is active because the snap already represents a stronger geometric constraint.
 */

const CLOSE_DIST = 10
const PERP_THRESHOLD_MULT = 2.5   // perp snap radius = endpoint radius × this
const PARALLEL_THRESHOLD_RAD = 6 * (Math.PI / 180)  // 6° angular tolerance

/** Snap a point to a horizontal/vertical line through the anchor (Shift). */
function snapOrtho(anchor: { x: number; y: number }, p: { x: number; y: number }) {
  const dx = p.x - anchor.x
  const dy = p.y - anchor.y
  return Math.abs(dx) >= Math.abs(dy) ? { x: p.x, y: anchor.y } : { x: anchor.x, y: p.y }
}

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
  /** Guide metadata for the Step-3 overlay renderer. */
  guide: SnapGuide | null
  /** True when P2 or P3 snap is active — suppresses Shift-ortho. */
  isAdvanced: boolean
}

function resolveSnap(
  raw: { x: number; y: number },
  pts: { x: number; y: number }[],
  zoom: number,
): SnapResult {
  const { spatialIndex } = useDrawingStore.getState()
  const snapRadiusW = SNAP_THRESHOLD_PX / zoom

  // ── Priority 1: endpoint snap ───────────────────────────────────────────
  // Candidates are committed graph vertices/midpoints (spatial index) AND the
  // vertices of the in-progress polyline — so snapping engages mid-draw, before
  // anything has been committed. The last placed vertex (P) is excluded: snapping
  // the rubber band onto its own anchor would be a degenerate zero-length segment.
  let epPos: { x: number; y: number } | null = null
  let epVid: string | undefined
  let epDistSq = snapRadiusW * snapRadiusW

  const ep = spatialIndex.nearest(raw.x, raw.y, snapRadiusW)
  if (ep) {
    epPos = { x: ep.x, y: ep.y }
    epVid = ep.vid ?? undefined
    const dx = ep.x - raw.x
    const dy = ep.y - raw.y
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
    const guide: SnapGuide | null =
      pts.length > 0
        ? {
            type: 'endpoint',
            fromPoint: [pts[pts.length - 1].x, pts[pts.length - 1].y],
            toPoint: [epPos.x, epPos.y],
            sourceVertexId: epVid,
          }
        : null
    return {
      pos: epPos,
      snapTarget: { x: epPos.x, y: epPos.y, kind: 'VERTEX', vid: epVid ?? null, edge: null },
      guide,
      isAdvanced: false,
    }
  }

  // ── Priorities 2 & 3: require an active polyline session ────────────────
  if (pts.length > 0) {
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
    const candidates = [...spatialIndex.nearbyEdgeEndpoints(raw.x, raw.y), ...activeSegs]

    // ── Priority 2: perpendicular snap ──────────────────────────────────
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

    // ── Priority 3: parallel snap ────────────────────────────────────────
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
  }

  return { pos: raw, snapTarget: null, guide: null, isAdvanced: false }
}

// ---------------------------------------------------------------------------

export function usePolyline() {
  const { camera } = useThree()
  const baseWidth = useDrawingStore((s) => s.baseWidth)
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const commitStroke = useDrawingStore((s) => s.commitStroke)

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
    useDrawingStore.getState().setSnapGuide(null)
  }, [])

  const finish = useCallback(() => {
    const pts = pointsRef.current
    if (pts.length >= 2) {
      const half = baseWidth / 2
      const sample: SamplePoint[] = pts.map((p) => ({ x: p.x, y: p.y, w: half }))
      commitStroke(sample, strokeColor, undefined, true)
    }
    reset()
  }, [baseWidth, strokeColor, commitStroke, reset])

  const cancel = useCallback(() => reset(), [reset])

  // Key handling: Shift state (preview reacts immediately on hold/release without
  // needing a pointer move) and Enter/Esc control flow.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(true)
        return
      }
      if (pointsRef.current.length === 0) return
      if (e.key === 'Enter') {
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
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [finish, cancel])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return
      const pts = pointsRef.current
      const zoom = (camera as OrthographicCamera).zoom || 1
      const raw = { x: e.point.x, y: e.point.y }

      // Run the full priority matrix at click time (not just the last move result)
      // so the committed vertex is at the precise snapped coordinate.
      const { pos, snapTarget, isAdvanced } = resolveSnap(raw, pts, zoom)

      // Shift-ortho only when no geometric snap constrained the position.
      let p = pos
      if (!snapTarget && !isAdvanced && e.nativeEvent.shiftKey && pts.length > 0) {
        p = snapOrtho(pts[pts.length - 1], pos)
      }

      // Click near the first vertex closes the polyline.
      if (pts.length >= 2 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= CLOSE_DIST) {
        pointsRef.current = [...pts, { ...pts[0] }]
        finish()
        return
      }
      pointsRef.current = [...pts, p]
      setPoints(pointsRef.current)
    },
    [finish, camera],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const zoom = (camera as OrthographicCamera).zoom || 1
      const raw = { x: e.point.x, y: e.point.y }
      // Run full snap pipeline; store results in refs to be flushed by RAF.
      // Note: for P2/P3 snaps, result.pos is the snapped position (not raw),
      // so the existing effCursor logic in the preview path works without
      // additional changes — it just reads `cursor` which becomes the snap pos.
      const result = resolveSnap(raw, pointsRef.current, zoom)
      cursorRef.current = result.pos
      snapRef.current = result.snapTarget
      snapGuideRef.current = result.guide
      isAdvancedSnapRef.current = result.isAdvanced
      scheduleCursor()
    },
    [scheduleCursor, camera],
  )

  const onPointerUp = useCallback(() => {}, [])
  const onDoubleClick = useCallback(() => finish(), [finish])

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

  return { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, preview, snap }
}
