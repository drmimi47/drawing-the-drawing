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
 * stroke with RDP and commits it. The full raw sample stream is retained on the
 * stroke (Tier 1) for future re-fitting / analysis.
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
  const usePressureRef = useRef(false)
  const startTimeRef = useRef(0)

  const finalize = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false

    const raw = rawRef.current
    rawRef.current = []
    setLive(null)

    if (raw.length < 2) return
    const simplified = simplifyRDP(raw, RDP_EPSILON)
    const points = rawToStrokePoints(simplified, baseWidth, usePressureRef.current)
    commitStroke(points, strokeColor, raw)
  }, [commitStroke, baseWidth, strokeColor])

  // Safety net: finalize even if the pointer is released off the canvas.
  useEffect(() => {
    const onUp = () => finalize()
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [finalize])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const ne = e.nativeEvent
      if (ne.button !== 0) return // only the primary button draws (middle/right pan, etc.)
      ;(ne.target as Element | null)?.setPointerCapture?.(ne.pointerId)

      usePressureRef.current = ne.pointerType === 'pen'
      drawingRef.current = true
      startTimeRef.current = performance.now()
      rawRef.current = [{ x: e.point.x, y: e.point.y, pressure: ne.pressure, t: 0 }]
      setLive(rawToStrokePoints(rawRef.current, baseWidth, usePressureRef.current))
    },
    [baseWidth],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!drawingRef.current) return
      const last = rawRef.current[rawRef.current.length - 1]
      const dx = e.point.x - last.x
      const dy = e.point.y - last.y
      if (dx * dx + dy * dy < MIN_POINT_DISTANCE * MIN_POINT_DISTANCE) return

      rawRef.current.push({
        x: e.point.x,
        y: e.point.y,
        pressure: e.nativeEvent.pressure,
        t: performance.now() - startTimeRef.current,
      })
      setLive(rawToStrokePoints(rawRef.current, baseWidth, usePressureRef.current))
    },
    [baseWidth],
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
