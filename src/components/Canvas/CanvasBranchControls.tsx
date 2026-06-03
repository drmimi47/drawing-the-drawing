import { useEffect, useRef, useState } from 'react'
import { Plus, Copy, FilePlus } from 'lucide-react'
import { useDrawingStore, type CardinalDirection, type CanvasInitMode } from '../../store/drawingStore'
import { useCanvasStore } from '../../store/canvasStore'

/**
 * Design-option branch controls.
 *
 * When the cursor hovers just OUTSIDE the midpoint of an edge of the active white
 * canvas (N / E / S / W), a "+" appears there. Clicking it opens a small chooser:
 *   • Duplicate board — copy the current board's full state into the new one.
 *   • Blank board     — start a fresh, empty board.
 * The chosen board is spawned adjacent in that direction (see store.addCanvas),
 * letting the user explore alternatives spatially as neighboring branches.
 *
 * Implemented as a screen-space DOM overlay (like SheetTitle / SheetScale) so it
 * never competes with the R3F interaction plane for pointer events; it projects the
 * active canvas's edge midpoints to screen using the shared viewport math.
 */

/** Screen px the "+" sits beyond the page edge, and the cursor proximity to reveal it. */
const OUT = 30
const SHOW_RADIUS = 90

const DIRECTIONS: CardinalDirection[] = ['N', 'E', 'S', 'W']

/** How the chooser popover is placed relative to the "+" so it opens outward. */
const MENU_TRANSFORM: Record<CardinalDirection, string> = {
  N: 'translate(-50%, -100%)',
  S: 'translate(-50%, 0)',
  E: 'translate(0, -50%)',
  W: 'translate(-100%, -50%)',
}

export function CanvasBranchControls() {
  const canvases = useDrawingStore((s) => s.canvases)
  const activeCanvasId = useDrawingStore((s) => s.activeCanvasId)
  const pageWidth = useDrawingStore((s) => s.pageWidth)
  const pageHeight = useDrawingStore((s) => s.pageHeight)
  const addCanvas = useDrawingStore((s) => s.addCanvas)
  const viewport = useCanvasStore((s) => s.viewport)
  const origin = canvases.find((c) => c.id === activeCanvasId)?.origin ?? { x: 0, y: 0 }

  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  // Open chooser: which edge it belongs to + where to anchor it (overlay px).
  const [menu, setMenu] = useState<{ dir: CardinalDirection; x: number; y: number } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Track the cursor in overlay-local pixels (the overlay fills the canvas area but
  // is pointer-transparent, so the move listener lives on the window).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      if (x < 0 || y < 0 || x > r.width || y > r.height) setCursor(null)
      else setCursor({ x, y })
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  // While the chooser is open, dismiss it on Escape or any pointerdown outside it.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (target && target.closest('.canvas-branch-menu')) return
      setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const vw = viewport.maxX - viewport.minX
  const vh = viewport.maxY - viewport.minY
  const ok = size.w > 0 && vw > 0 && vh > 0

  const sx = (wx: number) => ((wx - viewport.minX) / vw) * size.w
  const sy = (wy: number) => ((viewport.maxY - wy) / vh) * size.h

  // The "+" anchor (button center, in overlay px) for each edge: the edge midpoint
  // projected to screen, nudged OUT pixels beyond the edge.
  const anchorFor = (dir: CardinalDirection): { x: number; y: number } => {
    if (dir === 'N') return { x: sx(origin.x), y: sy(origin.y + pageHeight / 2) - OUT }
    if (dir === 'S') return { x: sx(origin.x), y: sy(origin.y - pageHeight / 2) + OUT }
    if (dir === 'E') return { x: sx(origin.x + pageWidth / 2) + OUT, y: sy(origin.y) }
    return { x: sx(origin.x - pageWidth / 2) - OUT, y: sy(origin.y) } // 'W'
  }

  const spawn = (mode: CanvasInitMode) => {
    if (menu) addCanvas(menu.dir, mode)
    setMenu(null)
  }

  return (
    <div ref={ref} className="canvas-branch-overlay" aria-hidden={!ok}>
      {ok &&
        DIRECTIONS.map((dir) => {
          const a = anchorFor(dir)
          // Visible while the cursor lingers just outside this edge's midpoint, or
          // while this edge's chooser is open. Buttons stay mounted so opacity/scale
          // can transition in AND out.
          const visible =
            menu?.dir === dir || (cursor != null && Math.hypot(cursor.x - a.x, cursor.y - a.y) <= SHOW_RADIUS)
          return (
            <button
              key={dir}
              type="button"
              className={`canvas-branch-btn${visible ? ' is-visible' : ''}`}
              style={{ left: a.x, top: a.y }}
              title="Add a design-option board here"
              tabIndex={visible ? 0 : -1}
              onClick={() => setMenu({ dir, x: a.x, y: a.y })}
            >
              <Plus size={16} strokeWidth={2.5} />
            </button>
          )
        })}

      {ok && menu && (
        <div
          className="canvas-branch-menu"
          style={{ left: menu.x, top: menu.y, transform: MENU_TRANSFORM[menu.dir] }}
        >
          <button type="button" className="canvas-branch-menu-item" onClick={() => spawn('copy')}>
            <Copy size={14} strokeWidth={2} />
            <span>
              Duplicate board
              <small>Copy this board's state</small>
            </span>
          </button>
          <button type="button" className="canvas-branch-menu-item" onClick={() => spawn('blank')}>
            <FilePlus size={14} strokeWidth={2} />
            <span>
              Blank board
              <small>Start fresh &amp; empty</small>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
