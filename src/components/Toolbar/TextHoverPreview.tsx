import { useEffect, useRef } from 'react'
import { useDrawingStore } from '../../store/drawingStore'

/**
 * Ghost "add text" that trails the cursor while the Text tool is selected (and no
 * editor is open yet), so the user can eyeball placement before committing to a
 * click. Same size/position/lightness as the editor's placeholder, so the preview
 * reads exactly where the real text would land.
 *
 * Mounted inside .canvas-area (overflow:hidden) so it's clipped to the canvas and
 * never bleeds over the panels. Pointer coords are viewport-relative; we subtract
 * the canvas container's rect to get canvas-relative translate values (mirrors the
 * crosshair). DOM writes are coalesced into one rAF per frame.
 */
export function TextHoverPreview() {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const pending = useDrawingStore((s) => s.pendingText)
  const active = toolMode === 'TEXT' && !pending

  const containerRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) return
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
      const el = labelRef.current
      if (el) {
        el.style.transform = `translate3d(${x - ox}px, ${y - oy}px, 0)`
        el.style.visibility = 'visible' // reveal once we have a real position
      }
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
  }, [active])

  if (!active) return null

  return (
    <div ref={containerRef} className="text-hover-preview" aria-hidden="true">
      <div ref={labelRef} className="text-hover-label" style={{ visibility: 'hidden' }}>
        add text
      </div>
    </div>
  )
}
