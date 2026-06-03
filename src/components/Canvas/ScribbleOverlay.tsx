import { useEffect, useRef, useState } from 'react'
import { useDrawingStore } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'
import type { ScribbleStroke } from '../../types/geometry'

/**
 * Raster scribble layer. Committed scribbles (plus the in-progress one) are painted
 * onto a 2D <canvas> projected from world space with the same viewport math as the
 * text/boundary overlays — so they stay pinned in world space while panning/zooming
 * and remain visible ABOVE the map substrate on EVERY layer. Pen width is in world
 * units (scales with zoom, matching the previous vector stroke). Non-interactive;
 * the eraser deletes whole strokes via the store, which repaints here.
 */
export function ScribbleOverlay() {
  const scribbles = useDrawingStore((s) => s.scribbles)
  const live = useDrawingStore((s) => s.liveScribble)
  const viewport = useCanvasStore((s) => s.viewport)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const { w: W, h: H } = size
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const vw = viewport.maxX - viewport.minX
    const vh = viewport.maxY - viewport.minY
    if (W <= 0 || vw <= 0 || vh <= 0) return

    const pxPerWorldX = W / vw
    const pxPerWorldY = H / vh
    const sx = (wx: number) => (wx - viewport.minX) * pxPerWorldX
    const sy = (wy: number) => (viewport.maxY - wy) * pxPerWorldY // +y world is up

    const drawStroke = (st: ScribbleStroke) => {
      const pts = st.points
      if (pts.length === 0) return
      const lw = Math.max(1, st.width * pxPerWorldX)
      ctx.strokeStyle = st.color
      ctx.fillStyle = st.color
      ctx.lineWidth = lw
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (pts.length === 1) {
        ctx.beginPath()
        ctx.arc(sx(pts[0].x), sy(pts[0].y), lw / 2, 0, Math.PI * 2)
        ctx.fill()
        return
      }
      ctx.beginPath()
      ctx.moveTo(sx(pts[0].x), sy(pts[0].y))
      for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i].x), sy(pts[i].y))
      ctx.stroke()
    }

    for (const st of scribbles) drawStroke(st)
    if (live) drawStroke(live)
  }, [scribbles, live, viewport, size])

  return (
    <div ref={wrapRef} className="scribble-overlay" aria-hidden>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  )
}
