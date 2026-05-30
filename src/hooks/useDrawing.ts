import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useDrawingStore, nextStrokeId, type StrokePoint } from '../store/drawingStore'
import { simplifyRDP, type RawPoint } from '../geometry/simplify'
import { rawToStrokePoints } from '../components/Canvas/strokeGeometry'

/**
 * Freehand drawing controller (Cluster B).
 *
 * Consumes R3F pointer events (whose `point` is already in world space, so this
 * keeps working once pan/zoom land in Cluster C). It buffers a raw point stream
 * during a drag, renders a live preview, and on release simplifies the stroke
 * with RDP before committing it to the store.
 */

const MIN_POINT_DISTANCE = 1.2 // world units — drops jittery near-duplicate samples
const RDP_EPSILON = 1.0 // world units — simplification tolerance

export function useDrawing() {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const baseWidth = useDrawingStore((s) => s.baseWidth)
  const addStroke = useDrawingStore((s) => s.addStroke)

  const [live, setLive] = useState<StrokePoint[] | null>(null)
  const rawRef = useRef<RawPoint[]>([])
  const drawingRef = useRef(false)
  const usePressureRef = useRef(false)

  const finalize = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false

    const raw = rawRef.current
    rawRef.current = []
    setLive(null)

    if (raw.length < 2) return
    const simplified = simplifyRDP(raw, RDP_EPSILON)
    const points = rawToStrokePoints(simplified, baseWidth, usePressureRef.current)
    addStroke({ id: nextStrokeId(), color: strokeColor, points })
  }, [addStroke, baseWidth, strokeColor])

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
      rawRef.current = [{ x: e.point.x, y: e.point.y, p: ne.pressure }]
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

      rawRef.current.push({ x: e.point.x, y: e.point.y, p: e.nativeEvent.pressure })
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
