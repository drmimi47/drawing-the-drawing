import { useEffect, useRef, useState } from 'react'
import { useDrawingStore } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'

/**
 * Magenta reference outline of the committed lot boundary, drawn in the Context
 * layer as an HTML/SVG overlay ABOVE the canvas and the live Mapbox map.
 *
 * The R3F BoundaryView can't be seen in Context when the Map substrate is active
 * (the interactive map sits above the drawing canvas), so this screen-space
 * overlay projects the boundary's world coordinates with the same viewport math
 * the map window uses — keeping the reference pinned in world space while the user
 * re-frames the map beneath it. It works identically for the Map, Blank-sheet, and
 * Import substrates. Purely informational: pointer-events are disabled.
 */
export function BoundaryContextOverlay() {
  const activeLayer = useDrawingStore((s) => s.activeLayer)
  const boundary = useDrawingStore((s) => s.boundary)
  const viewport = useCanvasStore((s) => s.viewport)

  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const vw = viewport.maxX - viewport.minX
  const vh = viewport.maxY - viewport.minY
  const closed = boundary?.isClosed !== false
  const show =
    activeLayer === 'CONTEXT' && boundary != null && boundary.ring.length >= 2 && size.w > 0 && vw > 0 && vh > 0

  // World → screen px (mirrors artboardScreenRect's sx/sy; +y world is up).
  const sx = (wx: number) => ((wx - viewport.minX) / vw) * size.w
  const sy = (wy: number) => ((viewport.maxY - wy) / vh) * size.h
  const points = show ? boundary!.ring.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ') : ''

  return (
    <div ref={ref} className="boundary-context-overlay" aria-hidden>
      {show && (
        <svg width={size.w} height={size.h}>
          {/* closed ⇒ polygon (magenta); open/incomplete ⇒ polyline (red warning). */}
          {closed ? (
            <polygon points={points} fill="none" stroke="#e000c0" strokeWidth={2} strokeLinejoin="round" />
          ) : (
            <polyline points={points} fill="none" stroke="#dc2626" strokeWidth={2} strokeLinejoin="round" />
          )}
        </svg>
      )}
    </div>
  )
}
