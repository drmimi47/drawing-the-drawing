import { useEffect, useRef } from 'react'

/**
 * CAD-style crosshair that follows the pointer, clipped to the canvas area.
 *
 * Mounted inside .canvas-area (position:relative) so overflow:hidden naturally
 * stops the lines at the canvas edge — they never bleed over the right panel.
 *
 * clientX/clientY from PointerEvent are viewport-relative; we subtract the
 * canvas container's bounding rect so the translate values are canvas-relative.
 *
 * Performance: pointer events only record coords; all DOM writes happen inside
 * a single rAF callback (at most one repaint per frame). Transforms are
 * compositor-only (translate3d) — no layout/paint cost.
 */
export function Crosshair() {
  const containerRef = useRef<HTMLDivElement>(null)
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
      const rect = containerRef.current?.getBoundingClientRect()
      const ox = rect?.left ?? 0
      const oy = rect?.top ?? 0
      const v = vRef.current
      const h = hRef.current
      if (v) v.style.transform = `translate3d(${x - ox}px, 0, 0)`
      if (h) h.style.transform = `translate3d(0, ${y - oy}px, 0)`
    }

    const onMove = (e: PointerEvent) => {
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
    <div ref={containerRef} className="crosshair" aria-hidden="true">
      <div ref={vRef} className="crosshair-line crosshair-line--v" />
      <div ref={hRef} className="crosshair-line crosshair-line--h" />
    </div>
  )
}
