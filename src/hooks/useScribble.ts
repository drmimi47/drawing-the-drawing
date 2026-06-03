import { useCallback, useEffect, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useDrawingStore } from '../store/drawingStore'
import { clampToPage } from '../geometry/page'

/**
 * Scribble controller — a pure raster annotation tool. Unlike the Polyline tool it
 * does NOT touch the planar graph: it just buffers world-space pointer samples and
 * commits them as a standalone ScribbleStroke that the canvas overlay paints. No
 * pressure / tilt / smoothing — a Wacom user simply draws steadier, but every
 * sample is treated equally. Pointer moves are coalesced to one buffer push per
 * frame; points are clamped to the artboard so marks can't spill into the grey.
 */

const MIN_POINT_DISTANCE = 1.2 // world units — drops jittery near-duplicate samples

export function useScribble() {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const baseWidth = useDrawingStore((s) => s.baseWidth)
  const addScribble = useDrawingStore((s) => s.addScribble)
  const setLiveScribble = useDrawingStore((s) => s.setLiveScribble)

  const drawingRef = useRef(false)
  const ptsRef = useRef<{ x: number; y: number }[]>([])
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const rafRef = useRef(0)

  const publishLive = useCallback(() => {
    setLiveScribble({ id: 'live', color: strokeColor, width: baseWidth, points: ptsRef.current.slice() })
  }, [setLiveScribble, strokeColor, baseWidth])

  const flush = useCallback(() => {
    rafRef.current = 0
    if (!drawingRef.current) return
    const s = lastRef.current
    if (!s) return
    const pts = ptsRef.current
    const last = pts[pts.length - 1]
    const dx = s.x - last.x
    const dy = s.y - last.y
    if (dx * dx + dy * dy < MIN_POINT_DISTANCE * MIN_POINT_DISTANCE) return
    pts.push({ x: s.x, y: s.y })
    publishLive()
  }, [publishLive])

  const schedule = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flush)
  }, [flush])

  const finalize = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    const pts = ptsRef.current
    ptsRef.current = []
    lastRef.current = null
    setLiveScribble(null)
    if (pts.length >= 1) addScribble(pts, strokeColor, baseWidth)
  }, [addScribble, setLiveScribble, strokeColor, baseWidth])

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
      if (ne.button !== 0) return
      ;(ne.target as Element | null)?.setPointerCapture?.(ne.pointerId)
      drawingRef.current = true
      const { pageWidth, pageHeight } = useDrawingStore.getState()
      const c = clampToPage({ x: e.point.x, y: e.point.y }, pageWidth, pageHeight)
      ptsRef.current = [c]
      lastRef.current = c
      publishLive()
    },
    [publishLive],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!drawingRef.current) return
      const { pageWidth, pageHeight } = useDrawingStore.getState()
      lastRef.current = clampToPage({ x: e.point.x, y: e.point.y }, pageWidth, pageHeight)
      schedule()
    },
    [schedule],
  )

  const onPointerUp = useCallback(() => finalize(), [finalize])

  return { active: toolMode === 'DRAW', onPointerDown, onPointerMove, onPointerUp }
}
