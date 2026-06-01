import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useDrawingStore } from '../store/drawingStore'
import type { RawSample, SamplePoint } from '../types/geometry'
import { simplifyRDP } from '../geometry/simplify'
import { rawToStrokePoints } from '../components/Canvas/strokeGeometry'

/**
 * Freehand drawing controller (Cluster B; commits to the graph since Cluster D).
 *
 * Buffers raw pointer samples during a drag (R3F's `point` is world space, so it
 * survives pan/zoom), renders a live preview, and on release simplifies the
 * stroke with RDP and commits it. The raw sample stream is retained (Tier 1).
 *
 * Strokes are a FIXED, uniform thickness: pointer pressure / tilt / speed are
 * ignored entirely. Pointer moves are coalesced into one buffer rebuild per
 * frame via requestAnimationFrame. (Orthogonal Shift-snapping is polyline-only.)
 */

const MIN_POINT_DISTANCE = 1.2 // world units — drops jittery near-duplicate samples
const RDP_EPSILON = 0.7 // world units — keep control points faithful for smoothing

export function useDrawing() {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const baseWidth = useDrawingStore((s) => s.baseWidth)
  const commitStroke = useDrawingStore((s) => s.commitStroke)

  const [live, setLive] = useState<SamplePoint[] | null>(null)
  const rawRef = useRef<RawSample[]>([])
  const drawingRef = useRef(false)
  const startTimeRef = useRef(0)

  // The latest pointer position, applied to the buffer on the next frame.
  const lastSampleRef = useRef<{ x: number; y: number } | null>(null)
  const rafRef = useRef(0)

  // Append the latest pointer position to the buffer and refresh the live
  // preview. Lightweight — runs at most once per frame.
  const applyLatest = useCallback(() => {
    rafRef.current = 0
    if (!drawingRef.current) return
    const s = lastSampleRef.current
    if (!s) return

    const lastPt = rawRef.current[rawRef.current.length - 1]
    const dx = s.x - lastPt.x
    const dy = s.y - lastPt.y
    if (dx * dx + dy * dy < MIN_POINT_DISTANCE * MIN_POINT_DISTANCE) return
    rawRef.current.push({ x: s.x, y: s.y, pressure: 0, t: performance.now() - startTimeRef.current })
    setLive(rawToStrokePoints(rawRef.current, baseWidth))
  }, [baseWidth])

  const schedule = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(applyLatest)
  }, [applyLatest])

  const finalize = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }

    const raw = rawRef.current
    rawRef.current = []
    lastSampleRef.current = null
    setLive(null)

    if (raw.length < 2) return
    const simplified = simplifyRDP(raw, RDP_EPSILON)
    const points = rawToStrokePoints(simplified, baseWidth)
    commitStroke(points, strokeColor, raw)
  }, [commitStroke, baseWidth, strokeColor])

  // Safety net: finalize even if the pointer is released off the canvas.
  useEffect(() => {
    const onUp = () => finalize()
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [finalize])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const ne = e.nativeEvent
      if (ne.button !== 0) return // only the primary button draws (middle/right pan, etc.)
      ;(ne.target as Element | null)?.setPointerCapture?.(ne.pointerId)

      drawingRef.current = true
      startTimeRef.current = performance.now()
      rawRef.current = [{ x: e.point.x, y: e.point.y, pressure: 0, t: 0 }]
      lastSampleRef.current = { x: e.point.x, y: e.point.y }
      setLive(rawToStrokePoints(rawRef.current, baseWidth))
    },
    [baseWidth],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!drawingRef.current) return
      lastSampleRef.current = { x: e.point.x, y: e.point.y }
      schedule()
    },
    [schedule],
  )

  const onPointerUp = useCallback(() => finalize(), [finalize])

  return {
    active: toolMode === 'DRAW',
    liveColor: strokeColor,
    live,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
