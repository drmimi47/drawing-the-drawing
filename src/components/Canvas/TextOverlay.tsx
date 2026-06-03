import { useEffect, useRef, useState } from 'react'
import { useDrawingStore } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'

/**
 * Committed text labels as a screen-space DOM overlay drawn ABOVE the map (live or
 * frozen) in EVERY layer — so text made in Lot Boundary / Circulation stays visible
 * over the Map substrate even when stepping back to Context.
 *
 * Each label's world anchor is projected with the same viewport math the map window
 * and BoundaryContextOverlay use, so labels stay pinned in world space as the canvas
 * pans/zooms. Font size is screen-constant (matches the old drei <Html> behavior).
 * The label currently being edited is hidden (the DOM editor shows it instead).
 * Non-interactive.
 */
export function TextOverlay() {
  const labels = useDrawingStore((s) => s.textLabels)
  const pending = useDrawingStore((s) => s.pendingText)
  const inactiveCanvasDocs = useDrawingStore((s) => s.inactiveCanvasDocs)
  const viewport = useCanvasStore((s) => s.viewport)
  const editingId = pending?.id ?? null

  // Labels belonging to the inactive design-option canvases (read-only; their
  // coordinates are absolute world space, same as the active canvas's).
  const ghostLabels = Object.values(inactiveCanvasDocs).flatMap((doc) => doc.textLabels)

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
  const ok = size.w > 0 && vw > 0 && vh > 0

  // World → screen px (mirrors BoundaryContextOverlay; +y world is up).
  const sx = (wx: number) => ((wx - viewport.minX) / vw) * size.w
  const sy = (wy: number) => ((viewport.maxY - wy) / vh) * size.h

  return (
    <div ref={ref} className="text-overlay" aria-hidden>
      {ok &&
        [...ghostLabels, ...labels].map((label) =>
          label.id === editingId ? null : (
            <div
              key={label.id}
              className="text-overlay-label"
              style={{
                transform: `translate(${sx(label.x)}px, ${sy(label.y)}px)`,
                color: label.color,
                fontSize: `${label.size}px`,
              }}
            >
              {label.text}
            </div>
          ),
        )}
    </div>
  )
}
