import { useEffect, useRef, useState } from 'react'
import { GripVertical, ChevronDown, Type, Ruler, SlidersHorizontal } from 'lucide-react'
import { useDrawingStore } from '../../store/drawingStore'
import { LINEWEIGHTS } from '../../types/geometry'
import './ContextualBar.css'

/**
 * Photoshop-style contextual task bar.
 *
 * A compact floating row whose controls depend on the active tool. It spawns near
 * the bottom-center of the canvas and can be dragged anywhere by the gripper on its
 * left. Currently it appears only for the Scribble (DRAW) and Text tools:
 *   • Scribble → stroke color + line-weight presets.
 *   • Text     → stroke color + a (pseudo) size control.
 *
 * Rendered as a DOM overlay inside the canvas area; it keeps its dragged position
 * across tool switches (the instance stays mounted, just hidden between uses).
 */

const PRESET_COLORS = ['#1a1a1a', '#e23b3b', '#2f6fed', '#1f9d55', '#e8852b']

/** Stroke color picker (shared by both tools) — opens a small upward popover. */
function ColorControl() {
  const strokeColor = useDrawingStore((s) => s.strokeColor)
  const setColor = useDrawingStore((s) => s.setColor)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div className="ctx-field" ref={wrapRef}>
      <button
        type="button"
        className={`ctx-btn${open ? ' is-open' : ''}`}
        title="Color"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ctx-color-dot" style={{ background: strokeColor }} />
        <ChevronDown size={11} strokeWidth={2.25} />
      </button>

      {open && (
        <div className="ctx-popover ctx-popover--swatches">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`ctx-swatch${strokeColor === c ? ' is-active' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={`Color ${c}`}
              onClick={() => {
                setColor(c)
                setOpen(false)
              }}
            />
          ))}
          <label className="ctx-swatch ctx-swatch--custom" title="Custom color">
            <input type="color" value={strokeColor} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  )
}

/** Line-weight presets (Scribble) — compact thickness glyphs. */
function WeightControl() {
  const baseWidth = useDrawingStore((s) => s.baseWidth)
  const setBaseWidth = useDrawingStore((s) => s.setBaseWidth)
  return (
    <div className="ctx-weights" role="group" aria-label="Line weight">
      {LINEWEIGHTS.map((lw) => (
        <button
          key={lw.label}
          type="button"
          className={`ctx-weight${baseWidth === lw.width ? ' is-active' : ''}`}
          title={`${lw.label} (${lw.width}px)`}
          aria-pressed={baseWidth === lw.width}
          onClick={() => setBaseWidth(lw.width)}
        >
          <span className="ctx-weight-glyph" style={{ height: lw.width }} />
        </button>
      ))}
    </div>
  )
}

/** Text size — a placeholder control until per-label sizing is wired into the tool. */
function SizePseudoControl() {
  return (
    <button
      type="button"
      className="ctx-btn ctx-size-pseudo"
      title="Text size — coming soon"
      aria-disabled
      onClick={(e) => e.preventDefault()}
    >
      <Type size={13} strokeWidth={2} />
      <span>14 px</span>
      <ChevronDown size={11} strokeWidth={2.25} />
    </button>
  )
}

/** Polyline snapping-guides toggle. Off hides the construction guides, but vertex and
 *  edge object snaps keep working. */
function SnapGuidesControl() {
  const on = useDrawingStore((s) => s.snapGuidesEnabled)
  const setOn = useDrawingStore((s) => s.setSnapGuidesEnabled)
  return (
    <button
      type="button"
      className={`ctx-btn${on ? ' is-active' : ''}`}
      title="Snapping guides — vertex & edge snaps stay on when off"
      aria-pressed={on}
      onClick={() => setOn(!on)}
    >
      <Ruler size={13} strokeWidth={2} />
      <span>Guides {on ? 'on' : 'off'}</span>
    </button>
  )
}

/** Intent Pin bar: "Adjust" resizes every department's rooms to the placed Density/Openness
 *  fields. Only clickable once at least one Intent Pin exists on the Rooms layer. */
function IntentAdjustControl() {
  const intentPins = useDrawingStore((s) => s.intentPins)
  const applyIntent = useDrawingStore((s) => s.applyIntentToRooms)
  const setShowGrid = useDrawingStore((s) => s.setShowIntentGrid)
  const setShowLabels = useDrawingStore((s) => s.setShowIntentLabels)
  const canAdjust = intentPins.length > 0
  // Hovering Adjust previews the intent concentration grid + % and the pin type labels (moved
  // here from the ribbon Intent Pin button).
  const preview = (show: boolean) => {
    setShowGrid(show)
    setShowLabels(show)
  }
  return (
    <button
      type="button"
      className="ctx-btn"
      disabled={!canAdjust}
      title={canAdjust ? 'Add rooms where Density wins, remove where Openness wins (locked rooms kept)' : 'Place at least one Intent Pin first'}
      onClick={() => applyIntent()}
      onMouseEnter={() => preview(true)}
      onMouseLeave={() => preview(false)}
    >
      <SlidersHorizontal size={13} strokeWidth={2} />
      <span>Adjust</span>
    </button>
  )
}

export function ContextualBar() {
  const toolMode = useDrawingStore((s) => s.toolMode)
  const show =
    toolMode === 'DRAW' || toolMode === 'TEXT' || toolMode === 'POLYLINE' || toolMode === 'INTENT_PIN'

  const barRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null)
  // null → use the default bottom-center placement; otherwise absolute px in the
  // canvas area. Persists across tool switches so the bar stays where you put it.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const onGripDown = (e: React.PointerEvent) => {
    const bar = barRef.current
    if (!bar) return
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    // Use the TRUE rendered position, not offsetLeft/Top: the default placement uses
    // `left:50%` + `translateX(-50%)`, and offsetLeft ignores the transform — reading
    // it would make the bar jump right by half its width on the first grab.
    const parent = bar.offsetParent as HTMLElement | null
    const barRect = bar.getBoundingClientRect()
    const parentRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const startLeft = barRect.left - parentRect.left
    const startTop = barRect.top - parentRect.top
    dragRef.current = { startX: e.clientX, startY: e.clientY, startLeft, startTop }
    // Switch from the centered default to explicit px so dragging is smooth.
    setPos({ x: startLeft, y: startTop })
  }

  const onGripMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    const bar = barRef.current
    if (!d || !bar) return
    const parent = bar.offsetParent as HTMLElement | null
    let x = d.startLeft + (e.clientX - d.startX)
    let y = d.startTop + (e.clientY - d.startY)
    if (parent) {
      x = Math.max(0, Math.min(parent.clientWidth - bar.offsetWidth, x))
      y = Math.max(0, Math.min(parent.clientHeight - bar.offsetHeight, y))
    }
    setPos({ x, y })
  }

  const onGripUp = (e: React.PointerEvent) => {
    dragRef.current = null
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
  }

  if (!show) return null

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { left: '50%', bottom: 24, transform: 'translateX(-50%)' }

  return (
    <div ref={barRef} className="ctx-bar" style={style} role="toolbar" aria-label="Tool options">
      <button
        type="button"
        className="ctx-grip"
        title="Drag to move"
        aria-label="Drag to move"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
      >
        <GripVertical size={14} strokeWidth={2} />
      </button>
      <span className="ctx-divider" />
      {(toolMode === 'DRAW' || toolMode === 'TEXT') && <ColorControl />}
      {toolMode === 'DRAW' && <WeightControl />}
      {toolMode === 'TEXT' && <SizePseudoControl />}
      {toolMode === 'POLYLINE' && <SnapGuidesControl />}
      {toolMode === 'INTENT_PIN' && <IntentAdjustControl />}
    </div>
  )
}
