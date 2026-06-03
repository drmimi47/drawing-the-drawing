import { useEffect, useRef, useState } from 'react'
import { useDrawingStore } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'
import { formatScale } from '../../geometry/geoScale'

/**
 * Real-world scale readout pinned just BELOW the artboard's bottom-left corner —
 * out on the grey background, the mirror of the "Central 01" sheet title at the
 * bottom-right. Driven by store.metersPerWorldUnit (set while framing the Map
 * substrate in Context), so it persists FROZEN and informative across every layer
 * once the map is calibrated. Hidden when there is no map scale (e.g. Blank Sheet).
 * Projected from world space, so it tracks the sheet as the canvas pans/zooms.
 */

const GAP = 8 // px below the sheet's bottom edge

export function SheetScale() {
  const mpu = useDrawingStore((s) => s.metersPerWorldUnit)
  const pageWidth = useDrawingStore((s) => s.pageWidth)
  const pageHeight = useDrawingStore((s) => s.pageHeight)
  const canvases = useDrawingStore((s) => s.canvases)
  const activeCanvasId = useDrawingStore((s) => s.activeCanvasId)
  const origin = canvases.find((c) => c.id === activeCanvasId)?.origin ?? { x: 0, y: 0 }
  const viewport = useCanvasStore((s) => s.viewport)

  const wrapRef = useRef<HTMLDivElement>(null)
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

  const vw = viewport.maxX - viewport.minX
  const vh = viewport.maxY - viewport.minY
  const show = mpu != null && size.w > 0 && vw > 0 && vh > 0

  let left = 0
  let top = 0
  if (show) {
    // Artboard bottom-LEFT corner in world space (page centered at the active
    // canvas's origin). The box's left edge aligns to the sheet's left edge, just
    // below the bottom edge.
    left = ((origin.x - pageWidth / 2 - viewport.minX) / vw) * size.w
    top = ((viewport.maxY - (origin.y - pageHeight / 2)) / vh) * size.h + GAP
  }

  return (
    <div ref={wrapRef} className="sheet-scale-overlay" aria-hidden>
      {show && (
        <div className="sheet-scale" style={{ left, top }} role="status">
          Scale · 1 unit ≈ <span className="sheet-scale-value">{formatScale(mpu!)}</span>
        </div>
      )}
    </div>
  )
}
