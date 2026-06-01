import { useEffect, useRef } from 'react'

/**
 * Full-viewport precision crosshair (CAD-style) that follows the pointer.
 *
 * Two 1px lines — one full-width horizontal, one full-height vertical —
 * intersecting at the pointer. Performance notes:
 * - Driven by `pointermove` (mouse + pen/stylus), but the handler only records
 *   the latest coordinates; the DOM is written inside a single
 *   `requestAnimationFrame` callback that runs just before the browser repaints.
 *   This coalesces bursts of pointer events into at most one update per frame,
 *   so the main thread never gets overloaded.
 * - Positions are applied with `transform: translate3d(x, y, 0)` (compositor-only,
 *   GPU-accelerated, no layout/paint) — never `top`/`left`.
 * - The container is `pointer-events: none`, so clicks and selection pass through.
 */
export function Crosshair() {
  const vRef = useRef<HTMLDivElement>(null)
  const hRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let rafId = 0
    let x = 0
    let y = 0
    let dirty = false

    const paint = () => {
      rafId = 0
      if (!dirty) return
      dirty = false
      const v = vRef.current
      const h = hRef.current
      if (v) v.style.transform = `translate3d(${x}px, 0, 0)`
      if (h) h.style.transform = `translate3d(0, ${y}px, 0)`
    }

    const onMove = (e: PointerEvent) => {
      // Record only; defer the DOM write to the next animation frame.
      x = e.clientX
      y = e.clientY
      dirty = true
      if (!rafId) rafId = requestAnimationFrame(paint)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  return (
    <div className="crosshair" aria-hidden="true">
      <div ref={vRef} className="crosshair-line crosshair-line--v" />
      <div ref={hRef} className="crosshair-line crosshair-line--h" />
    </div>
  )
}
