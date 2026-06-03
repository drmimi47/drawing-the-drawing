import { useEffect, useRef, useState } from 'react'
import { useDrawingStore } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'

/**
 * Editable sheet title sitting just BELOW the artboard's bottom edge, right-aligned
 * to its right edge — out on the grey background, the only element there. Light grey
 * (matching the Text tool's "add text" prompt). Click to rename inline; Enter or blur
 * commits, Escape reverts. Projected from world space with the same viewport math as
 * the other overlays, so it tracks the sheet as the canvas pans/zooms.
 */

const GAP = 8 // px below the sheet's bottom edge

export function SheetTitle() {
  const name = useDrawingStore((s) => s.sheetName)
  const setName = useDrawingStore((s) => s.setSheetName)
  const pageWidth = useDrawingStore((s) => s.pageWidth)
  const pageHeight = useDrawingStore((s) => s.pageHeight)
  const viewport = useCanvasStore((s) => s.viewport)

  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

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
    if (editing) {
      setDraft(name)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [editing, name])

  const vw = viewport.maxX - viewport.minX
  const vh = viewport.maxY - viewport.minY
  const ok = size.w > 0 && vw > 0 && vh > 0
  if (!ok) return <div ref={wrapRef} className="sheet-title-overlay" aria-hidden />

  // Artboard bottom-right corner in world space (page is centered at origin). The
  // title's right edge aligns to the sheet's right edge, just below the bottom edge.
  const sx = ((pageWidth / 2 - viewport.minX) / vw) * size.w
  const sy = ((viewport.maxY - -pageHeight / 2) / vh) * size.h
  const left = sx
  const top = sy + GAP

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed) setName(trimmed)
    setEditing(false)
  }

  return (
    <div ref={wrapRef} className="sheet-title-overlay">
      {editing ? (
        <input
          ref={inputRef}
          className="sheet-title sheet-title--input"
          style={{ left, top }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          onBlur={commit}
        />
      ) : (
        <button
          type="button"
          className="sheet-title"
          style={{ left, top }}
          title="Rename sheet"
          onClick={() => setEditing(true)}
        >
          {name}
        </button>
      )}
    </div>
  )
}
